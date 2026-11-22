/**
 * Direct messages on in-memory Postgres with every real migration applied:
 * opt-in and the 18+ confirmation, requests, blocking, row-level security,
 * rate limits, reports and owner moderation.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";
const CARA = "00000000-0000-4000-8000-0000000000c1";
const DAN = "00000000-0000-4000-8000-0000000000d1";

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);

async function as<T = Record<string, unknown>>(who: string | null, q: string, p: unknown[] = []) {
  await db.exec(
    who ? `SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;` : "SET ROLE anon;",
  );
  try {
    return (await db.query<T>(q, p)).rows;
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}
const one = async <T = unknown>(who: string | null, q: string, p: unknown[] = []) =>
  ((await as<{ v: T }>(who, q, p))[0] as { v: T }).v;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => String(e.message),
  );

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

const start = (who: string, to: string, body: string) =>
  one<{ conversation_id: string; status: string }>(who, `SELECT public.dm_start($1, $2) AS v`, [
    to,
    body,
  ]);
const send = (who: string, conv: string, body: string) =>
  one<string>(who, `SELECT public.dm_send($1, $2) AS v`, [conv, body]);
const setMode = (who: string, mode: string, adult = false) =>
  one(who, `SELECT public.dm_set_mode($1, $2) AS v`, [mode, adult]);
const unread = (who: string) => one<number>(who, `SELECT public.dm_unread_count() AS v`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  // The real database has no blanket grants on the new tables; mirror that.
  await db.exec(`
    REVOKE ALL ON public.messaging_settings, public.dm_settings, public.dm_conversations, public.dm_messages,
      public.dm_removed_messages, public.dm_blocks, public.dm_suspensions FROM anon, authenticated;
    GRANT SELECT ON public.dm_settings, public.dm_conversations, public.dm_messages, public.dm_blocks TO authenticated;`);
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await signUp(CARA, "cara");
  await signUp(DAN, "dan");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 60_000);

afterAll(() => db?.close());

describe("direct messages", () => {
  it("is off for everyone until the owner switches it on (admins can try it first)", async () => {
    const s = await one<{ available: boolean; mode: string }>(
      ALICE,
      `SELECT public.dm_my_settings() AS v`,
    );
    expect(s).toMatchObject({ available: false, mode: "off", site_enabled: false });
    expect(
      await one<{ status: string }>(ALICE, `SELECT public.dm_can_message('bob') AS v`),
    ).toMatchObject({
      status: "unavailable",
    });
    expect(await fails(as(ALICE, `SELECT public.owner_set_messaging_enabled(true)`))).toMatch(
      /not authorized/i,
    );
    expect(
      (await one<{ available: boolean }>(OWNER, `SELECT public.dm_my_settings() AS v`)).available,
    ).toBe(true);
    await as(OWNER, `SELECT public.owner_set_messaging_enabled(true)`);
    expect(
      (await one<{ available: boolean }>(ALICE, `SELECT public.dm_my_settings() AS v`)).available,
    ).toBe(true);
  });

  it("needs the 18+ confirmation to turn messages on, and starts with everyone off", async () => {
    expect(await fails(setMode(ALICE, "requests"))).toMatch(/adult_required/);
    expect(await fails(start(ALICE, "bob", "hi"))).toMatch(/own_off/);
    await setMode(ALICE, "requests", true);
    // Confirmed once is enough.
    await setMode(ALICE, "off");
    await setMode(ALICE, "requests");
    expect(await fails(start(ALICE, "bob", "hi"))).toMatch(/closed/);
    await setMode(BOB, "requests", true);
    await setMode(CARA, "everyone", true);
  });

  let ab: string;
  it("sends a request that waits, allows one message and no links until accepted", async () => {
    expect(
      await one<{ status: string }>(ALICE, `SELECT public.dm_can_message('bob') AS v`),
    ).toMatchObject({
      status: "request",
    });
    expect(await fails(start(ALICE, "bob", "see https://spam.example"))).toMatch(
      /no_links_in_request/,
    );
    expect(await fails(start(ALICE, "bob", "visit spam.com now"))).toMatch(/no_links_in_request/);
    const r = await start(ALICE, "bob", "Hi Bob, love your wishlist");
    expect(r.status).toBe("request");
    ab = r.conversation_id;
    expect(await fails(send(ALICE, ab, "hello?"))).toMatch(/awaiting_accept/);
    expect(await unread(BOB)).toBe(1);
    expect(await unread(ALICE)).toBe(0);
    const inbox = await one<
      Array<{ status: string; i_requested: boolean; other_username: string }>
    >(BOB, `SELECT public.dm_list_conversations() AS v`);
    expect(inbox).toMatchObject([
      { status: "request", i_requested: false, other_username: "alice" },
    ]);
    // Only the person asked can accept.
    expect(await fails(as(ALICE, `SELECT public.dm_respond($1, true)`, [ab]))).toMatch(/not_found/);
    expect(await one(BOB, `SELECT public.dm_respond($1, true) AS v`, [ab])).toBe("active");
    await send(ALICE, ab, "Thanks! Here it is https://example.com");
    await send(BOB, ab, "Got it");
    await as(BOB, `SELECT public.dm_mark_read($1)`, [ab]);
    expect(await unread(BOB)).toBe(0);
    expect(await unread(ALICE)).toBe(1);
  });

  it("goes straight through to someone who accepts messages from everyone", async () => {
    const r = await start(ALICE, "cara", "Hey Cara");
    expect(r.status).toBe("active");
    await send(ALICE, r.conversation_id, "One more");
  });

  it("lets only the two people (and admins) read a conversation", async () => {
    const q = `SELECT count(*)::int AS v FROM public.dm_messages WHERE conversation_id = $1`;
    expect(await one(ALICE, q, [ab])).toBe(3);
    expect(await one(BOB, q, [ab])).toBe(3);
    expect(await one(CARA, q, [ab])).toBe(0);
    expect(await one(OWNER, q, [ab])).toBe(3);
    expect(await fails(as(null, `SELECT count(*) FROM public.dm_messages`))).toMatch(
      /permission denied/i,
    );
    expect(await fails(as(CARA, `SELECT public.dm_get_conversation($1)`, [ab]))).toMatch(
      /not_found/,
    );
    expect(await fails(as(CARA, `SELECT public.dm_send($1, 'x')`, [ab]))).toMatch(/not_found/);
    // Nobody writes to the tables directly.
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO public.dm_messages (conversation_id, sender_id, body) VALUES ($1, $2, 'x')`,
          [ab, ALICE],
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(await fails(as(ALICE, `UPDATE public.dm_conversations SET status = 'active'`))).toMatch(
      /permission denied/i,
    );
    expect(await fails(as(ALICE, `SELECT * FROM public.dm_removed_messages`))).toMatch(
      /permission denied/i,
    );
  });

  it("blocking stops messages both ways without telling the other person", async () => {
    await as(BOB, `SELECT public.dm_set_block('alice', true)`);
    expect(await fails(send(ALICE, ab, "still there?"))).toMatch(/closed/);
    expect(await fails(send(BOB, ab, "x"))).toMatch(/you_blocked/);
    const view = await one<{ can_send: string | null; i_blocked: boolean }>(
      BOB,
      `SELECT public.dm_get_conversation($1) AS v`,
      [ab],
    );
    expect(view).toMatchObject({ can_send: "you_blocked", i_blocked: true });
    expect(await one(BOB, `SELECT public.dm_list_blocks() AS v`)).toMatchObject([
      { username: "alice" },
    ]);
    await as(BOB, `SELECT public.dm_set_block('alice', false)`);
    await send(ALICE, ab, "back");
  });

  it("turning messages off closes incoming messages", async () => {
    await setMode(CARA, "off");
    expect(
      await one<{ status: string }>(ALICE, `SELECT public.dm_can_message('cara') AS v`),
    ).toMatchObject({ status: "closed" });
    await setMode(CARA, "everyone");
  });

  it("declined requests are hidden from the person who declined and can't be resent", async () => {
    await setMode(DAN, "requests", true);
    const r = await start(DAN, "bob", "hello");
    expect(await one(BOB, `SELECT public.dm_respond($1, false) AS v`, [r.conversation_id])).toBe(
      "declined",
    );
    expect(await fails(start(DAN, "bob", "please"))).toMatch(/closed/);
    const bobInbox = await one<Array<{ other_username: string }>>(
      BOB,
      `SELECT public.dm_list_conversations() AS v`,
    );
    expect(bobInbox.map((c) => c.other_username)).toEqual(["alice"]);
  });

  it("limits how fast one person can send and start conversations", async () => {
    const r = await start(CARA, "alice", "hi");
    expect(r.status).toBe("active");
    for (let i = 0; i < 19; i++) await send(CARA, r.conversation_id, `m${i}`);
    expect(await fails(send(CARA, r.conversation_id, "too many"))).toMatch(/rate_limited/);
    // Ten new conversations a day.
    await svc(
      `UPDATE dm_messages SET created_at = now() - interval '2 hours' WHERE sender_id = $1`,
      [CARA],
    );
    for (let i = 0; i < 10; i++) {
      const id = `00000000-0000-4000-8000-00000000f0${i}0`;
      await signUp(id, `fan${i}`);
      await svc(
        `INSERT INTO dm_settings (user_id, mode, adult_confirmed_at) VALUES ($1, 'everyone', now())`,
        [id],
      );
      await start(CARA, `fan${i}`, "hello");
    }
    await signUp("00000000-0000-4000-8000-00000000f999", "fanx");
    await svc(
      `INSERT INTO dm_settings (user_id, mode, adult_confirmed_at) VALUES ($1, 'everyone', now())`,
      ["00000000-0000-4000-8000-00000000f999"],
    );
    expect(await fails(start(CARA, "fanx", "hello"))).toMatch(/too_many_new/);
  });

  it("rejects empty and over-long messages", async () => {
    expect(await fails(send(ALICE, ab, "   "))).toMatch(/empty/);
    expect(await fails(send(ALICE, ab, "x".repeat(2001)))).toMatch(/too_long/);
  });

  let reported: string;
  it("reports a received message into the owner's reports, once", async () => {
    const view = await one<{ messages: Array<{ id: string; mine: boolean; body: string }> }>(
      BOB,
      `SELECT public.dm_get_conversation($1) AS v`,
      [ab],
    );
    const theirs = view.messages.filter((m) => !m.mine);
    reported = theirs[theirs.length - 1].id;
    const mine = view.messages.find((m) => m.mine)!;
    expect(
      await one(BOB, `SELECT public.dm_report_message($1, 'harassment', 'not ok') AS v`, [mine.id]),
    ).toBe("not_found");
    expect(await one(CARA, `SELECT public.dm_report_message($1, 'spam') AS v`, [reported])).toBe(
      "not_found",
    );
    expect(
      await one(BOB, `SELECT public.dm_report_message($1, 'harassment', 'not ok') AS v`, [
        reported,
      ]),
    ).toBe("ok");
    expect(
      await one(BOB, `SELECT public.dm_report_message($1, 'harassment') AS v`, [reported]),
    ).toBe("ok");
    const list = await one<Array<Record<string, unknown>>>(
      OWNER,
      `SELECT public.owner_list_reports('open') AS v`,
    );
    const msgReports = list.filter((r) => r.target_kind === "message");
    expect(msgReports).toHaveLength(1);
    expect(msgReports[0]).toMatchObject({
      target_username: "alice",
      reporter_username: "bob",
      message_excerpt: "back",
      message_removed: false,
      target_messaging_suspended: false,
    });
  });

  it("lets the owner remove a message (text kept for the owner only) and suspend messaging", async () => {
    expect(await fails(as(BOB, `SELECT public.owner_remove_message($1)`, [reported]))).toMatch(
      /not authorized/i,
    );
    await as(OWNER, `SELECT public.owner_remove_message($1, 'harassment')`, [reported]);
    const view = await one<{
      messages: Array<{ id: string; body: string | null; removed: boolean }>;
    }>(ALICE, `SELECT public.dm_get_conversation($1) AS v`, [ab]);
    expect(view.messages.find((m) => m.id === reported)).toMatchObject({
      body: null,
      removed: true,
    });
    const raw = await as<{ body: string | null }>(
      BOB,
      `SELECT body FROM public.dm_messages WHERE id = $1`,
      [reported],
    );
    expect(raw).toEqual([{ body: null }]);
    expect(
      await svc(`SELECT body FROM dm_removed_messages WHERE message_id = $1`, [reported]),
    ).toEqual([{ body: "back" }]);

    await as(OWNER, `SELECT public.owner_set_messaging_suspended($1, true, 'harassment')`, [ALICE]);
    expect(await fails(send(ALICE, ab, "hi"))).toMatch(/suspended/);
    expect(
      await one<{ suspended: boolean }>(ALICE, `SELECT public.dm_my_settings() AS v`),
    ).toMatchObject({ suspended: true });
    expect(
      await one<{ suspended: boolean }>(OWNER, `SELECT public.owner_user_messaging($1) AS v`, [
        ALICE,
      ]),
    ).toMatchObject({
      suspended: true,
      reports_about: 1,
    });
    // Others can't message a suspended person either.
    expect(await fails(send(BOB, ab, "hi"))).toMatch(/closed/);
    await as(OWNER, `SELECT public.owner_set_messaging_suspended($1, false)`, [ALICE]);
    await send(ALICE, ab, "sorry");
    const log = await svc<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE action LIKE 'messag%' ORDER BY created_at, action`,
    );
    expect(log.map((l) => l.action).sort()).toEqual([
      "message.removed",
      "messaging.enabled",
      "messaging.suspended",
      "messaging.unsuspended",
    ]);
    const status = await one<Record<string, number | boolean>>(
      OWNER,
      `SELECT public.owner_messaging_status() AS v`,
    );
    expect(status).toMatchObject({ enabled: true, suspended: 0, open_message_reports: 1 });
  });

  it("deleting an account removes that person's messages, conversations, blocks and settings", async () => {
    await as(BOB, `SELECT public.dm_set_block('dan', true)`);
    await svc(`DELETE FROM auth.users WHERE id = $1`, [BOB]);
    const [r] = await svc<Record<string, number>>(`
      SELECT (SELECT count(*)::int FROM dm_conversations WHERE '${BOB}' IN (user_a, user_b)) AS convs,
             (SELECT count(*)::int FROM dm_messages WHERE sender_id = '${BOB}') AS msgs,
             (SELECT count(*)::int FROM dm_blocks WHERE '${BOB}' IN (blocker_id, blocked_id)) AS blocks,
             (SELECT count(*)::int FROM dm_settings WHERE user_id = '${BOB}') AS settings`);
    expect(r).toEqual({ convs: 0, msgs: 0, blocks: 0, settings: 0 });
    // The report keeps its copy of the reported text.
    const [rep] = await svc<{ message_excerpt: string }>(
      `SELECT message_excerpt FROM abuse_reports WHERE target_kind = 'message'`,
    );
    expect(rep.message_excerpt).toBe("back");
  });

  it("switching the site off stops everyone but admins", async () => {
    await as(OWNER, `SELECT public.owner_set_messaging_enabled(false)`);
    expect(
      await one<{ status: string }>(ALICE, `SELECT public.dm_can_message('cara') AS v`),
    ).toMatchObject({
      status: "unavailable",
    });
  });
});
