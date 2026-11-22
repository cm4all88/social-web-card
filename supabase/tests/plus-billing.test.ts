/**
 * Yooits Plus on in-memory Postgres with every real migration applied:
 * who is on Plus (Founding Members grant or a paid subscription), the two
 * Plus settings that only Plus can switch on, what happens when Plus ends
 * (nothing deleted, the page just ignores the settings), who can read the
 * billing records, and that the rollback puts the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FREE = "00000000-0000-4000-8000-0000000000f1";
const FOUNDER = "00000000-0000-4000-8000-0000000000f2";
const PAYER = "00000000-0000-4000-8000-0000000000f3";

const ROLLBACK = new URL("../rollbacks/20261122120000_plus_billing.down.sql", import.meta.url);

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
async function as<T = Record<string, unknown>>(who: string | null, q: string, p: unknown[] = []) {
  await db.exec(who ? `SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;` : "SET ROLE anon;");
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
const plan = async (uid: string) =>
  (await svc<{ p: string }>(`SELECT public.current_plan($1) AS p`, [uid]))[0].p;
const publicPlus = async (uid: string) =>
  (await as<{ p: boolean }>(null, `SELECT public.public_profile_is_plus($1) AS p`, [uid]))[0].p;

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}
const sub = (id: string, uid: string, status: string, livemode = false, amount = 499) =>
  svc(
    `INSERT INTO public.plus_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, status, price_id, unit_amount_cents, currency, livemode)
     VALUES ($1, $2, 'cus_test1', $3, 'price_plus', $4, 'usd', $5)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = EXCLUDED.status`,
    [id, uid, status, amount, livemode],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "theboss");
  await svc(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [OWNER]);
  await signUp(FREE, "sam");
  await signUp(FOUNDER, "jordan");
  await signUp(PAYER, "maya");
  await svc(
    `INSERT INTO public.plan_entitlements (user_id, plan, source, ends_at) VALUES ($1, 'plus', 'founding_creator', now() + interval '3 months')`,
    [FOUNDER],
  );
}, 90_000);

afterAll(async () => {
  await db?.close();
});

describe("Yooits Plus plan", () => {
  it("is free by default, Plus for a Founding Member, and Plus for an active subscription", async () => {
    expect(await plan(FREE)).toBe("free");
    expect(await plan(FOUNDER)).toBe("plus");
    expect(await plan(PAYER)).toBe("free");
    for (const [status, want] of [
      ["incomplete", "free"],
      ["trialing", "plus"],
      ["active", "plus"],
      ["past_due", "plus"],
      ["unpaid", "free"],
      ["canceled", "free"],
    ] as const) {
      await sub("sub_payer1", PAYER, status);
      expect(await plan(PAYER), status).toBe(want);
      expect(await publicPlus(PAYER), status).toBe(want === "plus");
    }
  });

  it("lets only Plus switch on hidden branding and premium themes", async () => {
    await sub("sub_payer1", PAYER, "active");
    expect(
      await fails(as(FREE, `UPDATE public.profiles SET hide_branding = true WHERE user_id = $1`, [FREE])),
    ).toMatch(/part of Plus/);
    expect(
      await fails(as(FREE, `UPDATE public.profiles SET theme = 'aurora' WHERE user_id = $1`, [FREE])),
    ).toMatch(/part of Plus/);
    // Free themes and custom colors stay free.
    expect(await fails(as(FREE, `UPDATE public.profiles SET theme = 'sunset' WHERE user_id = $1`, [FREE]))).toBeNull();
    expect(await fails(as(FREE, `UPDATE public.profiles SET theme = 'custom' WHERE user_id = $1`, [FREE]))).toBeNull();

    for (const uid of [FOUNDER, PAYER]) {
      expect(
        await fails(as(uid, `UPDATE public.profiles SET hide_branding = true, theme = 'gilded' WHERE user_id = $1`, [uid])),
      ).toBeNull();
    }
    const rows = await svc<{ hide_branding: boolean; theme: string }>(
      `SELECT hide_branding, theme FROM public.profiles WHERE user_id = $1`,
      [PAYER],
    );
    expect(rows[0]).toEqual({ hide_branding: true, theme: "gilded" });
  });

  it("when Plus ends, keeps the settings, still lets the creator edit, and the page stops honouring them", async () => {
    await sub("sub_payer1", PAYER, "canceled");
    expect(await plan(PAYER)).toBe("free");
    expect(await publicPlus(PAYER)).toBe(false);
    // Nothing deleted or changed.
    const before = await svc(`SELECT hide_branding, theme FROM public.profiles WHERE user_id = $1`, [PAYER]);
    expect(before[0]).toEqual({ hide_branding: true, theme: "gilded" });
    // Editing anything else still works; switching the benefit off works; back on doesn't.
    expect(await fails(as(PAYER, `UPDATE public.profiles SET bio = 'hi' WHERE user_id = $1`, [PAYER]))).toBeNull();
    expect(await fails(as(PAYER, `UPDATE public.profiles SET hide_branding = false WHERE user_id = $1`, [PAYER]))).toBeNull();
    expect(
      await fails(as(PAYER, `UPDATE public.profiles SET hide_branding = true WHERE user_id = $1`, [PAYER])),
    ).toMatch(/part of Plus/);
    // Leaving a premium theme for a free one is allowed; going back isn't.
    expect(await fails(as(PAYER, `UPDATE public.profiles SET theme = 'ocean' WHERE user_id = $1`, [PAYER]))).toBeNull();
    expect(
      await fails(as(PAYER, `UPDATE public.profiles SET theme = 'gilded' WHERE user_id = $1`, [PAYER])),
    ).toMatch(/part of Plus/);
  });

  it("a Founding Members grant ends on its own and doesn't renew, even with the new plan logic", async () => {
    await svc(`UPDATE public.plan_entitlements SET ends_at = now() - interval '1 second', starts_at = now() - interval '3 months' WHERE user_id = $1`, [FOUNDER]);
    expect(await plan(FOUNDER)).toBe("free");
    const g = await svc<{ auto_renew: boolean }>(`SELECT auto_renew FROM public.plan_entitlements WHERE user_id = $1`, [FOUNDER]);
    expect(g[0].auto_renew).toBe(false);
    expect(await fails(svc(`UPDATE public.plan_entitlements SET auto_renew = true WHERE user_id = $1`, [FOUNDER]))).toMatch(/check/i);
  });

  it("billing records are server-written and readable only by their owner and admins", async () => {
    await sub("sub_payer1", PAYER, "active");
    await svc(`INSERT INTO public.billing_customers (stripe_customer_id, user_id, livemode) VALUES ('cus_test1', $1, false)`, [PAYER]);
    expect((await as(PAYER, `SELECT * FROM public.plus_subscriptions`)).length).toBe(1);
    expect((await as(FREE, `SELECT * FROM public.plus_subscriptions`)).length).toBe(0);
    expect((await as(null, `SELECT * FROM public.plus_subscriptions`)).length).toBe(0);
    expect((await as(OWNER, `SELECT * FROM public.plus_subscriptions`)).length).toBe(1);
    expect((await as(PAYER, `SELECT * FROM public.billing_customers`)).length).toBe(0);
    for (const who of [PAYER, FREE, null]) {
      expect(
        await fails(as(who, `INSERT INTO public.plus_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, livemode) VALUES ('sub_fake', $1, 'cus_x', 'active', true)`, [FREE])),
      ).not.toBeNull();
      expect(await fails(as(who, `UPDATE public.plus_subscriptions SET status = 'active'`))).toBeNull(); // no rows visible to change
    }
    expect((await svc<{ s: string }>(`SELECT status AS s FROM public.plus_subscriptions WHERE stripe_subscription_id = 'sub_payer1'`))[0].s).toBe("active");
    expect(await fails(as(FREE, `SELECT public.current_plan($1)`, [FREE]))).toMatch(/permission/);
    expect((await as<{ p: string }>(PAYER, `SELECT public.my_plan() AS p`))[0].p).toBe("plus");
    expect((await as<{ p: string }>(FREE, `SELECT public.my_plan() AS p`))[0].p).toBe("free");
  });

  it("owner summary counts only live subscriptions as revenue", async () => {
    await sub("sub_live1", FREE, "active", true);
    await sub("sub_live2", OWNER, "trialing", true);
    const s = (await as<{ s: Record<string, number> }>(OWNER, `SELECT public.owner_plus_summary() AS s`))[0].s;
    expect(s.paying).toBe(1);
    expect(s.trialing).toBe(1);
    expect(s.monthly_revenue_cents).toBe(499);
    expect(s.test_mode_active).toBe(1);
    expect(await fails(as(FREE, `SELECT public.owner_plus_summary()`))).toMatch(/Admins only/);
  });

  it("account deletion keeps subscription records with no user attached", async () => {
    await svc(`DELETE FROM auth.users WHERE id = $1`, [FREE]);
    const r = await svc<{ user_id: string | null }>(`SELECT user_id FROM public.plus_subscriptions WHERE stripe_subscription_id = 'sub_live1'`);
    expect(r[0].user_id).toBeNull();
  });
});

const one = async (d: PGlite, q: string) => (await d.query<{ v: string }>(q)).rows[0].v;
const fns = (d: PGlite) =>
  one(d, `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname, p.oid) AS v
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`);
const cols = (d: PGlite) =>
  one(d, `SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, ordinal_position) AS v
            FROM information_schema.columns WHERE table_schema = 'public'`);
const policies = (d: PGlite) =>
  one(d, `SELECT coalesce(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual,'') || coalesce(with_check,'')), ',' ORDER BY tablename, policyname), '') AS v FROM pg_policies WHERE schemaname = 'public'`);
const triggers = (d: PGlite) =>
  one(d, `SELECT coalesce(string_agg(tgname, ',' ORDER BY tgname), '') AS v FROM pg_trigger WHERE NOT tgisinternal`);

describe("Plus billing migration", () => {
  it("only adds, keeps every row, and its rollback puts the schema back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("CREATE TABLE public.plus_subscriptions"));
    expect(idx).toBeGreaterThan(-1);
    const d = new PGlite();
    await d.exec(SUPABASE_STUBS);
    await d.exec(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`);
    for (const sql of all.slice(0, idx)) await d.exec(sql);
    await d.exec(SUPABASE_GRANTS);
    await d.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@example.test', '{"username":"alice"}')`, [FREE]);
    await d.query(`UPDATE public.profiles SET theme = 'royal', bio = 'hello' WHERE user_id = $1`, [FREE]);

    const snap = async () => ({
      f: await fns(d),
      c: await cols(d),
      p: await policies(d),
      t: await triggers(d),
      prof: await one(d, `SELECT md5(string_agg(row(id, user_id, username, display_name, bio, theme, custom_theme, avatar_url, updated_at)::text, '|' ORDER BY id)) AS v FROM public.profiles`),
    });
    const before = await snap();

    await d.exec(all[idx]);
    await d.exec(SUPABASE_GRANTS);
    const after = await snap();
    expect(after.prof).toBe(before.prof); // existing profile data unchanged
    const newCols = after.c.split(",").filter((x) => !before.c.split(",").includes(x));
    expect(newCols.every((c) => c === "profiles.hide_branding:boolean" || c.startsWith("billing_customers.") || c.startsWith("plus_subscriptions."))).toBe(true);
    const changedFns = after.f.split(",").filter((x) => !before.f.split(",").includes(x)).map((x) => x.split("=")[0]);
    expect(changedFns.sort()).toEqual([
      "current_plan",
      "my_plan",
      "owner_plus_summary",
      "plus_status_is_active",
      "profiles_enforce_plus_features",
      "public_profile_is_plus",
      "theme_is_premium",
    ]);

    // Refuses while billing records exist.
    await d.query(`INSERT INTO public.billing_customers (stripe_customer_id, user_id, livemode) VALUES ('cus_keep', $1, false)`, [FREE]);
    await expect(d.exec(readFileSync(ROLLBACK, "utf8"))).rejects.toThrow(/payment records/);
    await d.query(`DELETE FROM public.billing_customers`);

    await d.exec(readFileSync(ROLLBACK, "utf8"));
    expect(await snap()).toEqual(before);
    await d.close();
  }, 90_000);
});
