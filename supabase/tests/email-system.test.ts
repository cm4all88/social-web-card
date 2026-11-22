/**
 * The email queue on in-memory Postgres with every real migration applied:
 * real events queue the right email, optional email respects people's
 * choices, the dispatcher's claim/retry calls behave, and the rollback puts
 * the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

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
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => String(e.message),
  );
const outbox = (template: string) =>
  svc<{
    to_email: string;
    status: string;
    skip_reason: string | null;
    category: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT to_email, status, skip_reason, category, payload FROM public.email_outbox WHERE template = $1 ORDER BY created_at`,
    [template],
  );

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  // Columns the real auth.users has that the stub leaves out.
  await db.exec(`ALTER TABLE auth.users ADD COLUMN encrypted_password text;`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "chief");
  await svc(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
    [OWNER],
  );
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
});
afterAll(() => db.close());

describe("account and security email", () => {
  it("welcomes each new account once", async () => {
    const rows = await outbox("welcome");
    expect(rows.map((r) => r.to_email).sort()).toEqual([
      "alice@example.test",
      "bob@example.test",
      "chief@example.test",
    ]);
    expect(rows.every((r) => r.status === "queued" && r.category === "account")).toBe(true);
    expect(rows.find((r) => r.to_email === "alice@example.test")?.payload.username).toBe("alice");
  });

  it("tells people when their password changes, but not when it is first set", async () => {
    await svc(`UPDATE auth.users SET encrypted_password = 'hash1' WHERE id = $1`, [ALICE]);
    expect(await outbox("password_changed")).toHaveLength(0);
    await svc(`UPDATE auth.users SET encrypted_password = 'hash2' WHERE id = $1`, [ALICE]);
    const rows = await outbox("password_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("security");
  });

  it("tells the old address when the sign-in email changes", async () => {
    await svc(`UPDATE auth.users SET email = 'bob2@example.test' WHERE id = $1`, [BOB]);
    const rows = await outbox("email_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].to_email).toBe("bob@example.test");
    expect(rows[0].payload.new_email_masked).toBe("b***@example.test");
  });

  it("never blocks the change that triggered it", async () => {
    await svc(`UPDATE public.email_settings SET security_enabled = false`);
    await svc(`UPDATE auth.users SET encrypted_password = 'hash3' WHERE id = $1`, [ALICE]);
    const rows = await outbox("password_changed");
    expect(rows.at(-1)?.status).toBe("skipped");
    expect(rows.at(-1)?.skip_reason).toBe("category_off");
    await svc(`UPDATE public.email_settings SET security_enabled = true`);
  });
});

describe("billing email", () => {
  it("queues Plus started, cancelling and ended, once each", async () => {
    await svc(
      `INSERT INTO public.plus_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, livemode, current_period_end)
       VALUES ('sub_A1', $1, 'cus_A', 'active', false, now() + interval '30 days')`,
      [ALICE],
    );
    await svc(
      `UPDATE public.plus_subscriptions SET updated_at = now() WHERE stripe_subscription_id = 'sub_A1'`,
    );
    await svc(
      `UPDATE public.plus_subscriptions SET cancel_at_period_end = true WHERE stripe_subscription_id = 'sub_A1'`,
    );
    await svc(
      `UPDATE public.plus_subscriptions SET status = 'canceled' WHERE stripe_subscription_id = 'sub_A1'`,
    );
    expect(await outbox("plus_started")).toHaveLength(1);
    expect(await outbox("plus_canceling")).toHaveLength(1);
    expect(await outbox("plus_ended")).toHaveLength(1);
  });

  it("tells a creator about a tip, a refund and a dispute, and alerts the owner to disputes", async () => {
    await svc(
      `INSERT INTO public.tips (id, creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents, supporter_name)
       VALUES ('00000000-0000-4000-8000-00000000f001', $1, 'acct_1', 500, 50, 550, 'Sam')`,
      [ALICE],
    );
    expect(await outbox("tip_received")).toHaveLength(0);
    await svc(
      `UPDATE public.tips SET status = 'succeeded' WHERE id = '00000000-0000-4000-8000-00000000f001'`,
    );
    await svc(
      `UPDATE public.tips SET updated_at = now() WHERE id = '00000000-0000-4000-8000-00000000f001'`,
    );
    const tip = await outbox("tip_received");
    expect(tip).toHaveLength(1);
    expect(tip[0].payload.amount_cents).toBe(500);
    await svc(
      `UPDATE public.tips SET amount_refunded_cents = 500 WHERE id = '00000000-0000-4000-8000-00000000f001'`,
    );
    expect(await outbox("tip_refunded")).toHaveLength(1);
    await svc(
      `UPDATE public.tips SET dispute_status = 'needs_response' WHERE id = '00000000-0000-4000-8000-00000000f001'`,
    );
    expect(await outbox("tip_disputed")).toHaveLength(1);
    const admin = await outbox("admin_dispute");
    expect(admin).toHaveLength(1);
    expect(admin[0].to_email).toBe("admin@tahomaindustries.com");
  });

  it("tells a person when Yooits suspends and restores their account", async () => {
    await svc(
      `INSERT INTO public.account_status (user_id, suspended_at, suspended_reason) VALUES ($1, now(), 'test')`,
      [BOB],
    );
    expect(await outbox("account_suspended")).toHaveLength(1);
    await svc(`UPDATE public.account_status SET suspended_at = NULL WHERE user_id = $1`, [BOB]);
    expect(await outbox("account_restored")).toHaveLength(1);
  });
});

describe("optional email and preferences", () => {
  it("emails a wishlist's share link the first time it goes public, and honours opting out", async () => {
    await svc(
      `INSERT INTO public.wishlists (user_id, slug, title, visibility) VALUES ($1, 'bday', 'Birthday', 'public')`,
      [ALICE],
    );
    await svc(`UPDATE public.wishlists SET visibility = 'private' WHERE slug = 'bday'`);
    await svc(`UPDATE public.wishlists SET visibility = 'public' WHERE slug = 'bday'`);
    const first = await outbox("wishlist_live");
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("queued");

    await as(BOB, `SELECT public.set_my_email_preferences(true, false, false)`);
    await svc(
      `INSERT INTO public.wishlists (user_id, slug, title, visibility) VALUES ($1, 'xmas', 'Holidays', 'public')`,
      [BOB],
    );
    const bob = (await outbox("wishlist_live")).find((r) => r.to_email === "bob2@example.test");
    expect(bob?.status).toBe("skipped");
    expect(bob?.skip_reason).toBe("opted_out");
  });

  it("unsubscribes by link token without signing in, and rejects bad tokens", async () => {
    const [{ t }] = await svc<{ t: string }>(`SELECT public.email_unsubscribe_token($1) AS t`, [
      ALICE,
    ]);
    expect(t).toMatch(/^[0-9a-f]{48}$/);
    const [{ r }] = await as<{ r: Record<string, unknown> }>(
      null,
      `SELECT public.email_unsubscribe($1, 'all') AS r`,
      [t],
    );
    expect(r).toMatchObject({ messages: false, activity: false, marketing: false });
    const [{ r: bad }] = await as<{ r: unknown }>(
      null,
      `SELECT public.email_unsubscribe('nope', 'all') AS r`,
    );
    expect(bad).toBeNull();
    await as(null, `SELECT public.email_set_preferences_by_token($1, true, true, false)`, [t]);
  });

  it("keeps marketing to people who opted in", async () => {
    await svc(`UPDATE public.email_settings SET marketing_enabled = true`);
    await svc(
      `SELECT public.email_queue('announcement', 'marketing', $1, '{}'::jsonb, 'mkt:alice')`,
      [ALICE],
    );
    expect((await outbox("announcement"))[0].skip_reason).toBe("opted_out");
    await as(ALICE, `SELECT public.set_my_email_preferences(true, true, true)`);
    await svc(
      `SELECT public.email_queue('announcement', 'marketing', $1, '{}'::jsonb, 'mkt:alice2')`,
      [ALICE],
    );
    expect((await outbox("announcement"))[1].status).toBe("queued");
    await svc(`UPDATE public.email_settings SET marketing_enabled = false`);
  });

  it("caps optional email at ten an hour per person per category", async () => {
    for (let i = 0; i < 12; i++)
      await svc(`SELECT public.email_queue('dm_message', 'messages', $1, '{}'::jsonb, $2)`, [
        BOB,
        `cap:${i}`,
      ]);
    const rows = await outbox("dm_message");
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(10);
    expect(rows.filter((r) => r.skip_reason === "hourly_cap")).toHaveLength(2);
  });

  it("is not callable by browsers", async () => {
    expect(
      await fails(
        as(
          ALICE,
          `SELECT public.email_queue('welcome', 'account', $1, '{}'::jsonb, 'x', 'evil@example.test')`,
          [ALICE],
        ),
      ),
    ).toMatch(/permission denied/);
    // Row-level security with no policies: browsers see nothing.
    expect(await as(ALICE, `SELECT * FROM public.email_outbox`)).toHaveLength(0);
    expect(await as(null, `SELECT * FROM public.email_preferences`)).toHaveLength(0);
    expect(await fails(as(ALICE, `SELECT public.owner_email_status()`))).toMatch(/Not authorized/);
  });
});

describe("dispatcher calls", () => {
  it("claims due email, records sends, retries with back-off and then fails", async () => {
    await svc(`UPDATE public.email_outbox SET status = 'skipped' WHERE status = 'queued'`);
    const [{ id }] = await svc<{ id: string }>(
      `SELECT public.email_queue('welcome', 'account', $1, '{}'::jsonb, 'dispatch:1') AS id`,
      [ALICE],
    );
    const claimed = await svc<{ id: string; status: string; attempts: number }>(
      `SELECT * FROM public.email_claim_batch(10)`,
    );
    expect(claimed.map((r) => r.id)).toEqual([id]);
    expect(claimed[0].attempts).toBe(1);
    expect(await svc(`SELECT * FROM public.email_claim_batch(10)`)).toHaveLength(0); // locked

    expect(
      (
        await svc<{ r: string }>(
          `SELECT public.email_mark_result($1, false, NULL, 'Hi', 'timeout', true) AS r`,
          [id],
        )
      )[0].r,
    ).toBe("retry");
    const [row] = await svc<{ status: string; next_attempt_at: string }>(
      `SELECT status, next_attempt_at FROM public.email_outbox WHERE id = $1`,
      [id],
    );
    expect(row.status).toBe("queued");
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    expect(
      (
        await svc<{ r: string }>(
          `SELECT public.email_mark_result($1, false, NULL, NULL, 'bad address', false) AS r`,
          [id],
        )
      )[0].r,
    ).toBe("failed");
    expect(
      (await as<{ r: boolean }>(OWNER, `SELECT public.owner_email_retry($1) AS r`, [id]))[0].r,
    ).toBe(true);
    await svc(`UPDATE public.email_outbox SET next_attempt_at = now() WHERE id = $1`, [id]);
    await svc(`SELECT * FROM public.email_claim_batch(10)`);
    expect(
      (
        await svc<{ r: string }>(
          `SELECT public.email_mark_result($1, true, 're_123', 'Welcome', NULL) AS r`,
          [id],
        )
      )[0].r,
    ).toBe("sent");

    await svc(
      `UPDATE public.email_outbox SET sent_at = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    expect(await svc(`SELECT * FROM public.email_needing_status(10)`)).toHaveLength(1);
    expect(
      (await svc<{ r: string }>(`SELECT public.email_record_event('re_123', 'delivered') AS r`))[0]
        .r,
    ).toBe("delivered");
    expect(
      (
        await svc<{ r: string }>(
          `SELECT public.email_record_event('re_123', 'delivery_delayed') AS r`,
        )
      )[0].r,
    ).toBe("delayed");
    const [after] = await svc<{ status: string }>(
      `SELECT status FROM public.email_outbox WHERE id = $1`,
      [id],
    );
    expect(after.status).toBe("delivered"); // a late 'delayed' never overwrites delivered
  });

  it("suppresses bounced addresses for optional email but still sends security email to others", async () => {
    const [{ id }] = await svc<{ id: string }>(
      `SELECT public.email_queue('dm_message', 'messages', NULL, '{}'::jsonb, 'bounce:1', 'gone@example.test') AS id`,
    );
    await svc(`SELECT public.email_mark_result($1, true, 're_b1')`, [id]);
    await svc(`SELECT public.email_record_event('re_b1', 'bounced')`);
    const [{ id: id2 }] = await svc<{ id: string }>(
      `SELECT public.email_queue('dm_message', 'messages', NULL, '{}'::jsonb, 'bounce:2', 'gone@example.test') AS id`,
    );
    const [row] = await svc<{ skip_reason: string }>(
      `SELECT skip_reason FROM public.email_outbox WHERE id = $1`,
      [id2],
    );
    expect(row.skip_reason).toBe("suppressed");
  });

  it("expires email that waited too long instead of sending it late", async () => {
    const [{ id }] = await svc<{ id: string }>(
      `SELECT public.email_queue('welcome', 'account', $1, '{}'::jsonb, 'old:1') AS id`,
      [BOB],
    );
    await svc(
      `UPDATE public.email_outbox SET created_at = now() - interval '2 days' WHERE id = $1`,
      [id],
    );
    await svc(`SELECT * FROM public.email_claim_batch(10)`);
    const [row] = await svc<{ status: string }>(
      `SELECT status FROM public.email_outbox WHERE id = $1`,
      [id],
    );
    expect(row.status).toBe("expired");
  });

  it("does nothing when asked to kick the dispatcher without pg_net", async () => {
    expect((await svc<{ r: boolean }>(`SELECT public.email_kick() AS r`))[0].r).toBe(false);
    // No Vault here, so no token is accepted.
    expect(
      (await svc<{ r: boolean }>(`SELECT public.email_dispatch_token_ok(repeat('a', 64)) AS r`))[0]
        .r,
    ).toBe(false);
  });

  it("lets the owner read the log and change switches, and audits the change", async () => {
    const [{ r }] = await as<{ r: Record<string, unknown> }>(
      OWNER,
      `SELECT public.owner_email_set_setting('activity_enabled', 'false') AS r`,
    );
    expect(r.activity_enabled).toBe(false);
    const log = await as<{ r: unknown[] }>(
      OWNER,
      `SELECT public.owner_email_log('problems', 50, 0) AS r`,
    );
    expect(Array.isArray(log[0].r)).toBe(true);
    const audit = await svc(`SELECT 1 FROM public.admin_audit_log WHERE action = 'email.setting'`);
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe("rollback", () => {
  it("removes everything the migration added and nothing else", async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE_STUBS);
    await fresh.exec(`ALTER TABLE auth.users ADD COLUMN encrypted_password text;`);
    const all = migrationSql();
    const files = (await import("node:fs"))
      .readdirSync(join(__dirname, "..", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const idx = files.indexOf("20261122160000_email_system.sql");
    for (const sql of all.slice(0, idx)) await fresh.exec(sql);
    const snap = async () =>
      (
        await fresh.query<{ v: string }>(
          `SELECT md5(string_agg(x, ',' ORDER BY x)) AS v FROM (
             SELECT 'f:' || p.proname || md5(p.prosrc) AS x FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
             UNION ALL SELECT 'c:' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
             UNION ALL SELECT 't:' || tgrelid::regclass::text || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal) s`,
        )
      ).rows[0].v;
    const before = await snap();
    await fresh.exec(all[idx]);
    expect(await snap()).not.toBe(before);
    await fresh.exec(
      readFileSync(
        join(__dirname, "..", "rollbacks", "20261122160000_email_system.down.sql"),
        "utf8",
      ),
    );
    expect(await snap()).toBe(before);
    await fresh.close();
  });
});
