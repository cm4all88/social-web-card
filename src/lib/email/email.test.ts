import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { AUTH_TEMPLATES, renderAuthTemplate } from "./auth-templates";
import { runDispatch, type DispatchDeps, type OutboxRow } from "./dispatch.server";
import { esc, safeHref } from "./layout";
import { MarketingNotReadyError, renderEmail, UnknownTemplateError } from "./render";
import { normalizeResendEvent, sendViaResend, verifyResendWebhook } from "./resend.server";
import { OPTIONAL_CATEGORIES, TEMPLATES } from "./templates";

const TOKEN = "a".repeat(48);

describe("email templates", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s renders HTML and plain text", (_id, t) => {
    const r = renderEmail(t.id, t.sample, {
      unsubscribeToken: TOKEN,
      isTest: t.category === "marketing",
    });
    expect(r.subject.length).toBeGreaterThan(3);
    expect(r.html).toContain("<!DOCTYPE html>");
    expect(r.html).toContain("https://yooits.me/email/yooits-logo.png");
    expect(r.html).toContain("Tahoma Industries LLC");
    expect(r.text).not.toMatch(/<[a-z]/i);
    expect(r.text).toContain("Tahoma Industries LLC");
    expect(r.from).toMatch(/@yooits\.me>$/);
    // Every link is https and on yooits.me (or a mailto).
    for (const m of r.html.matchAll(/href="([^"]+)"/g))
      expect(m[1]).toMatch(/^(https:\/\/yooits\.me|mailto:|https:\/\/[a-z0-9.-]+\.yooits\.me)/);
  });

  it("no payment receipts: Stripe sends those", () => {
    for (const t of TEMPLATES) expect(t.id).not.toMatch(/receipt|invoice/);
  });

  it("optional email gets one-click unsubscribe; account email does not", () => {
    for (const t of TEMPLATES) {
      const r = renderEmail(t.id, t.sample, { unsubscribeToken: TOKEN, isTest: true });
      if (OPTIONAL_CATEGORIES.includes(t.category)) {
        expect(r.headers["List-Unsubscribe"]).toBe(
          `<https://yooits.me/api/email/unsubscribe?t=${TOKEN}&c=${t.category}>`,
        );
        expect(r.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
        expect(r.html).toContain("Unsubscribe");
        expect(r.text).toContain(`Unsubscribe: https://yooits.me/email/preferences?t=${TOKEN}`);
      } else {
        expect(r.headers["List-Unsubscribe"]).toBeUndefined();
      }
    }
  });

  it("escapes what people typed", () => {
    const r = renderEmail(
      "dm_request",
      { from_display_name: '<img src=x onerror="alert(1)">', from_username: "x" },
      { unsubscribeToken: TOKEN },
    );
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;img");
    expect(esc(`"'&`)).toBe("&quot;&#39;&amp;");
  });

  it("never puts a javascript: link in an href", () => {
    expect(safeHref("javascript:alert(1)")).toBe("https://yooits.me");
    const r = renderEmail(
      "announcement",
      {
        subject: "Hi there",
        heading: "Hi",
        body: "Hello everyone",
        button_label: "Go",
        button_url: "javascript:alert(1)",
      },
      { unsubscribeToken: TOKEN, isTest: true },
    );
    expect(r.html).not.toContain("javascript:");
  });

  it("marketing is held until the postal address is set", () => {
    expect(() =>
      renderEmail("announcement", TEMPLATES.find((t) => t.id === "announcement")!.sample, {
        unsubscribeToken: TOKEN,
      }),
    ).toThrow(MarketingNotReadyError);
  });

  it("test sends say so in the subject", () => {
    expect(renderEmail("welcome", { username: "maya" }, { isTest: true }).subject).toMatch(
      /^\[Test\] /,
    );
  });

  it("unknown templates are refused", () => {
    expect(() => renderEmail("nope", {})).toThrow(UnknownTemplateError);
  });

  it("owner alerts have no reply-to; the rest reply to the admin mailbox", () => {
    expect(
      renderEmail("admin_new_report", TEMPLATES.find((t) => t.id === "admin_new_report")!.sample)
        .replyTo,
    ).toBeNull();
    expect(renderEmail("welcome", { username: "maya" }).replyTo).toBe("admin@yooits.me");
  });
});

describe("Supabase sign-in templates", () => {
  it.each(AUTH_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s keeps Supabase's placeholder",
    (_id, t) => {
      const html = renderAuthTemplate(t);
      if (t.id === "reauthentication") expect(html).toContain("{{ .Token }}");
      else expect(html).toContain('href="{{ .ConfirmationURL }}"');
      expect(html).toContain("yooits-logo.png");
    },
  );
});

describe("Resend", () => {
  it("sends with an idempotency key and classifies errors", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const calls: RequestInit[] = [];
    const ok = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    });
    const input = {
      from: "a@yooits.me",
      to: "b@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      idempotencyKey: "k1",
    };
    expect(await sendViaResend(input, ok as never)).toEqual({ ok: true, id: "em_1" });
    expect((calls[0].headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");

    const rate = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "slow" }), {
          status: 429,
        }),
    );
    expect(await sendViaResend(input, rate as never)).toMatchObject({ ok: false, retryable: true });
    const bad = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "validation_error", message: "bad from" }), {
          status: 422,
        }),
    );
    expect(await sendViaResend(input, bad as never)).toMatchObject({ ok: false, retryable: false });
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await sendViaResend(input, down as never)).toMatchObject({ ok: false, retryable: true });
    delete process.env.RESEND_API_KEY;
  });

  it("maps events", () => {
    expect(normalizeResendEvent("delivered")).toBe("delivered");
    expect(normalizeResendEvent("bounced")).toBe("bounced");
    expect(normalizeResendEvent("sent")).toBeNull();
  });

  it("verifies webhook signatures", async () => {
    const raw = Buffer.from("secret-bytes-for-test").toString("base64");
    const secret = `whsec_${raw}`;
    const body = '{"type":"email.delivered"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(raw, "base64"))
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    expect(
      await verifyResendWebhook(
        secret,
        { id: "msg_1", timestamp: ts, signature: `v1,${sig}` },
        body,
      ),
    ).toBe(true);
    expect(
      await verifyResendWebhook(
        secret,
        { id: "msg_1", timestamp: ts, signature: `v1,${sig}` },
        body + " ",
      ),
    ).toBe(false);
    expect(
      await verifyResendWebhook(
        secret,
        { id: "msg_1", timestamp: "100", signature: `v1,${sig}` },
        body,
      ),
    ).toBe(false);
  });
});

describe("dispatcher", () => {
  const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
    id: "11111111-1111-1111-1111-111111111111",
    template: "welcome",
    category: "account",
    user_id: "u1",
    to_email: "maya@example.com",
    payload: { username: "maya" },
    is_test: false,
    attempts: 1,
    ...over,
  });

  function deps(rows: OutboxRow[], send: DispatchDeps["send"]) {
    const calls: { fn: string; args?: object }[] = [];
    const d: DispatchDeps = {
      configured: () => true,
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "email_claim_batch") return { data: rows, error: null };
        if (fn === "email_unsubscribe_token") return { data: TOKEN, error: null };
        if (fn === "email_mark_result")
          return { data: (args as { _ok: boolean })._ok ? "sent" : "queued", error: null };
        if (fn === "email_needing_status")
          return { data: [{ id: "x", provider_id: "em_9" }], error: null };
        return { data: null, error: null };
      },
      send,
      lastEvent: async () => "delivered",
    };
    return { d, calls };
  }

  it("does nothing without a Resend key", async () => {
    const { d, calls } = deps([row()], vi.fn());
    d.configured = () => false;
    expect(await runDispatch({}, d)).toMatchObject({ configured: false, claimed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("reports when the email tables aren't installed", async () => {
    const { d } = deps([], vi.fn());
    d.rpc = async () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    expect(await runDispatch({}, d)).toMatchObject({ ready: false });
  });

  it("sends, marks the result and checks delivery", async () => {
    const send = vi.fn(async () => ({ ok: true as const, id: "em_1" }));
    const { d, calls } = deps(
      [
        row(),
        row({
          id: "2",
          template: "dm_message",
          category: "messages",
          payload: { sender_name: "Ana", conversation_id: "c" },
        }),
      ],
      send,
    );
    const s = await runDispatch({}, d);
    expect(s).toMatchObject({ claimed: 2, sent: 2, statusChecked: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    const second = (
      send.mock.calls[1] as unknown as [{ headers: Record<string, string>; idempotencyKey: string }]
    )[0];
    expect(second.headers["List-Unsubscribe"]).toContain(TOKEN);
    expect(second.idempotencyKey).toBe("yooits-email-2");
    expect(calls.filter((c) => c.fn === "email_mark_result")).toHaveLength(2);
    expect(calls.find((c) => c.fn === "email_record_event")?.args).toMatchObject({
      _provider_id: "em_9",
      _type: "delivered",
    });
  });

  it("marks unknown templates as permanent failures", async () => {
    const send = vi.fn();
    const { d, calls } = deps([row({ template: "gone" })], send);
    await runDispatch({}, d);
    expect(send).not.toHaveBeenCalled();
    expect(calls.find((c) => c.fn === "email_mark_result")?.args).toMatchObject({
      _ok: false,
      _retryable: false,
    });
  });

  it("passes retryable send errors back to the queue", async () => {
    const send = vi.fn(async () => ({ ok: false as const, error: "429", retryable: true }));
    const { d, calls } = deps([row()], send);
    const s = await runDispatch({}, d);
    expect(s.retrying).toBe(1);
    expect(calls.find((c) => c.fn === "email_mark_result")?.args).toMatchObject({
      _ok: false,
      _retryable: true,
    });
  });
});

describe("supabase/templates", () => {
  it("match the templates in code (regenerate them if this fails)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const t of AUTH_TEMPLATES) {
      expect(readFileSync(`supabase/templates/${t.id}.html`, "utf8")).toBe(renderAuthTemplate(t));
    }
  });
});
