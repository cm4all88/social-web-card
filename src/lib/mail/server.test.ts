/* eslint-disable @typescript-eslint/no-explicit-any -- fake Google and Supabase */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: { fn: string; args: any }[] = [];
const store: { states: Map<string, any>; token: string | null; account: any } = {
  states: new Map(),
  token: null,
  account: null,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      switch (fn) {
        case "owner_mail_begin":
          store.states.set(args._state_hash, {
            owner_user_id: args._owner,
            code_verifier: args._code_verifier,
          });
          return { data: null, error: null };
        case "owner_mail_take_state": {
          const v = store.states.get(args._state_hash) ?? null;
          store.states.delete(args._state_hash);
          return { data: v, error: null };
        }
        case "owner_mail_save_token":
          store.token = args._refresh_token;
          store.account = { google_email: args._google_email, status: "connected" };
          return { data: null, error: null };
        case "owner_mail_token":
          return { data: store.token, error: null };
        case "owner_mail_mark_broken":
          if (store.account) store.account.status = "needs_reconnect";
          return { data: null, error: null };
        default:
          return { data: null, error: null };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: store.account, error: null }) }),
      }),
    }),
  },
}));

const { beginConnect, finishConnect, sha256Hex, MailReconnectError, _clearTokenCache } =
  await import("./google.server");
const { listThreads, getThread, send } = await import("./mailbox.server");
const { bytesToB64url } = await import("./mime");

type Handler = (
  url: URL,
  init: RequestInit,
) => { status?: number; json?: any; text?: string } | undefined;
let handlers: Handler[] = [];
const seen: { url: URL; init: RequestInit }[] = [];
const OWNER = "owner-1";
const enc = (s: string) => bytesToB64url(Buffer.from(s));
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.y`;

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
  handlers = [];
  seen.length = 0;
  rpcCalls.length = 0;
  store.states.clear();
  store.token = "stored-refresh";
  store.account = { google_email: "admin@tahomaindustries.com", status: "connected" };
  _clearTokenCache();
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    seen.push({ url, init });
    for (const h of handlers) {
      const r = h(url, init);
      if (r)
        return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }
    return new Response(JSON.stringify({ error: { message: `unhandled ${url.pathname}` } }), {
      status: 500,
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const tokenOk: Handler = (url) =>
  url.host === "oauth2.googleapis.com" && url.pathname === "/token"
    ? { json: { access_token: "access-1", expires_in: 3600 } }
    : undefined;

describe("connecting Gmail", () => {
  it("asks Google for offline Gmail access with PKCE and a one-time state", async () => {
    const u = new URL(await beginConnect(OWNER, "https://yooits.me"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("https://yooits.me/api/owner/mail/callback");
    expect(u.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/gmail.modify",
    );
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const state = u.searchParams.get("state")!;
    // only the hash of the state is stored
    expect(store.states.has(sha256Hex(state))).toBe(true);
    expect([...store.states.keys()]).not.toContain(state);
    expect(u.searchParams.get("client_secret")).toBeNull();
  });

  it("exchanges the code on the server and saves the token", async () => {
    const state = new URL(await beginConnect(OWNER, "https://yooits.me")).searchParams.get(
      "state",
    )!;
    handlers.push((url, init) => {
      if (url.pathname !== "/token") return;
      const b = new URLSearchParams(String(init.body));
      expect(b.get("code_verifier")).toMatch(/^[\w-]{43,}$/);
      expect(b.get("client_secret")).toBe("client-secret");
      return {
        json: {
          access_token: "a",
          refresh_token: "new-refresh",
          scope: "openid https://www.googleapis.com/auth/gmail.modify email",
          id_token: idToken("admin@tahomaindustries.com"),
        },
      };
    });
    expect(await finishConnect(state, "code-1", "https://yooits.me")).toEqual({
      ok: true,
      email: "admin@tahomaindustries.com",
    });
    expect(store.token).toBe("new-refresh");
    // the state can't be used twice
    expect(await finishConnect(state, "code-1", "https://yooits.me")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a sign-in without Gmail access or a lasting token", async () => {
    for (const [json, reason] of [
      [
        {
          access_token: "a",
          refresh_token: "r",
          scope: "openid email",
          id_token: idToken("a@b.co"),
        },
        "scope",
      ],
      [
        {
          access_token: "a",
          scope: "https://www.googleapis.com/auth/gmail.modify",
          id_token: idToken("a@b.co"),
        },
        "no_refresh",
      ],
    ] as const) {
      const state = new URL(await beginConnect(OWNER, "https://yooits.me")).searchParams.get(
        "state",
      )!;
      handlers = [() => ({ json })];
      store.token = null;
      expect(await finishConnect(state, "c", "https://yooits.me")).toEqual({ ok: false, reason });
      expect(store.token).toBeNull();
    }
  });
});

describe("reading mail", () => {
  it("lists conversations straight from Gmail", async () => {
    handlers.push(tokenOk, (url, init) => {
      expect((init.headers as any).Authorization).toBe("Bearer access-1");
      if (url.pathname.endsWith("/threads"))
        return { json: { threads: [{ id: "t1" }], nextPageToken: "p2", resultSizeEstimate: 30 } };
      if (url.pathname.endsWith("/threads/t1"))
        return {
          json: {
            id: "t1",
            messages: [
              {
                id: "m1",
                labelIds: ["INBOX"],
                internalDate: "1000",
                payload: {
                  headers: [
                    { name: "Subject", value: "Hello" },
                    { name: "From", value: "Ana <ana@x.com>" },
                  ],
                },
              },
              {
                id: "m2",
                labelIds: ["INBOX", "UNREAD", "STARRED"],
                internalDate: "2000",
                snippet: "latest",
                payload: { headers: [{ name: "From", value: "Bo <bo@x.com>" }] },
              },
            ],
          },
        };
    });
    const r = await listThreads(OWNER, { label: "INBOX", q: "from:ana", pageToken: null });
    const list = seen.find((s) => s.url.pathname.endsWith("/threads"))!.url;
    expect(list.searchParams.get("labelIds")).toBe("INBOX");
    expect(list.searchParams.get("q")).toBe("from:ana");
    expect(r.threads[0]).toMatchObject({
      id: "t1",
      subject: "Hello",
      from: "Bo <bo@x.com>",
      unread: true,
      starred: true,
      count: 2,
      date: 2000,
      snippet: "latest",
    });
    expect(r.nextPageToken).toBe("p2");
  });

  it("asks to reconnect when Google refuses the stored sign-in", async () => {
    handlers.push((url) =>
      url.pathname === "/token" ? { status: 400, json: { error: "invalid_grant" } } : undefined,
    );
    await expect(listThreads(OWNER, {})).rejects.toBeInstanceOf(MailReconnectError);
    expect(rpcCalls.some((c) => c.fn === "owner_mail_mark_broken")).toBe(true);
  });

  it("opens a conversation cleaned, and marks it read in Gmail", async () => {
    handlers.push(tokenOk, (url, init) => {
      if (url.pathname.endsWith("/threads/t1/modify")) {
        expect(JSON.parse(String(init.body))).toEqual({ removeLabelIds: ["UNREAD"] });
        return { json: {} };
      }
      if (url.pathname.endsWith("/threads/t1"))
        return {
          json: {
            id: "t1",
            messages: [
              {
                id: "m1",
                labelIds: ["INBOX", "UNREAD"],
                internalDate: "1",
                payload: {
                  mimeType: "multipart/mixed",
                  headers: [{ name: "Subject", value: "Hi" }],
                  parts: [
                    {
                      mimeType: "text/html",
                      body: {
                        data: enc('<p>Hi</p><script>x</script><img src="https://track/p.gif">'),
                      },
                    },
                    {
                      partId: "1",
                      mimeType: "application/pdf",
                      filename: "a.pdf",
                      body: { attachmentId: "AID", size: 9 },
                    },
                  ],
                },
              },
            ],
          },
        };
    });
    const t = await getThread(OWNER, "t1", false);
    expect(t.messages[0].html).not.toContain("script");
    expect(t.messages[0].blockedImages).toBe(1);
    expect(t.messages[0].attachments).toEqual([
      { partId: "1", filename: "a.pdf", mimeType: "application/pdf", size: 9 },
    ]);
    expect(t.labelIds).not.toContain("UNREAD");
    expect(seen.some((s) => s.url.pathname.endsWith("/threads/t1/modify"))).toBe(true);
  });
});

describe("sending", () => {
  const aliases = [
    { email: "admin@tahomaindustries.com", name: "Chris", isDefault: true, isPrimary: true },
    { email: "admin@yooits.me", name: "Yooits", isDefault: false, isPrimary: false },
  ];

  it("replies in the same Gmail conversation from admin@yooits.me", async () => {
    let raw = "";
    let meta = "";
    handlers.push(tokenOk, (url, init) => {
      if (url.pathname.endsWith("/messages/m1"))
        return {
          json: {
            id: "m1",
            threadId: "t1",
            payload: {
              headers: [
                { name: "Message-ID", value: "<orig@mail>" },
                { name: "References", value: "<root@mail>" },
              ],
            },
          },
        };
      if (url.pathname.endsWith("/messages/send")) {
        expect(url.host).toBe("gmail.googleapis.com");
        expect(url.pathname.startsWith("/upload/")).toBe(true);
        const body = String(init.body);
        meta = body
          .split("Content-Type: application/json; charset=UTF-8\r\n\r\n")[1]
          .split("\r\n")[0];
        raw = body;
        return { json: { id: "sent1", threadId: "t1" } };
      }
    });
    const r = await send(
      OWNER,
      {
        mode: "reply",
        messageId: "m1",
        from: "Admin@Yooits.me",
        to: "Ana <ana@x.com>",
        subject: "Re: Hi",
        body: "Thanks!",
      },
      aliases,
    );
    expect(r).toEqual({ id: "sent1", threadId: "t1" });
    expect(JSON.parse(meta)).toEqual({ threadId: "t1" });
    expect(raw).toContain('From: "Yooits" <admin@yooits.me>');
    expect(raw).toContain("In-Reply-To: <orig@mail>");
    expect(raw).toContain("References: <root@mail> <orig@mail>");
    expect(rpcCalls.find((c) => c.fn === "owner_mail_audit")?.args).toMatchObject({
      _action: "mail.sent",
      _target_id: "sent1",
    });
  });

  it("only sends from addresses Gmail allows, to valid addresses, with small uploads", async () => {
    handlers.push(tokenOk);
    await expect(
      send(
        OWNER,
        { mode: "new", from: "someone@else.com", to: "a@b.co", subject: "", body: "" },
        aliases,
      ),
    ).rejects.toThrow(/From/);
    await expect(
      send(
        OWNER,
        { mode: "new", from: "admin@yooits.me", to: "not-an-address", subject: "", body: "" },
        aliases,
      ),
    ).rejects.toThrow(/Check these/);
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64");
    await expect(
      send(
        OWNER,
        {
          mode: "new",
          from: "admin@yooits.me",
          to: "a@b.co",
          subject: "",
          body: "",
          attachments: [{ filename: "x", mimeType: "a/b", base64: big }],
        },
        aliases,
      ),
    ).rejects.toThrow(/3 MB/);
    expect(seen.some((s) => s.url.pathname.endsWith("/messages/send"))).toBe(false);
  });
});
