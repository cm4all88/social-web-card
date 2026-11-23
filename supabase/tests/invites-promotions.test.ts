/**
 * Invite codes and Promotions on in-memory Postgres with every real
 * migration: single and shared codes, expiry, revoking, promotion windows,
 * caps, eligibility, free Plus through plan_entitlements, owner-only access,
 * Founding Member codes left exactly as they were, and a clean rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);

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
async function signUp(id: string, username: string, invite_code?: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username, ...(invite_code ? { invite_code } : {}) }),
  ]);
}
const create = (opts: {
  count?: number;
  label?: string | null;
  days?: number | null;
  uses?: number;
  promo?: string | null;
  code?: string | null;
}) =>
  as<{ id: string; code: string; expires_at: string | null }>(
    OWNER,
    `SELECT * FROM public.owner_invite_create($1, $2, NULL, $3, $4, $5, $6)`,
    [opts.count ?? 1, opts.label ?? null, opts.days ?? null, opts.uses ?? 1, opts.promo ?? null, opts.code ?? null],
  );
const redeem = async (who: string, code: string) =>
  (await as<{ r: string }>(who, `SELECT public.redeem_code($1) AS r`, [code]))[0].r;
const state = async (code: string) =>
  (await as<{ s: { state: string; kind: string; plus_months?: number } }>(null, `SELECT public.code_state($1) AS s`, [code]))[0].s;
const plan = async (uid: string) =>
  (await svc<{ p: string }>(`SELECT public.current_plan($1) AS p`, [uid]))[0].p;
const savePromo = async (p: Record<string, unknown>) =>
  (await as<{ j: Record<string, unknown> }>(OWNER, `SELECT public.owner_promotion_save($1) AS j`, [JSON.stringify(p)]))[0].j;

let foundingCode = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await as(OWNER, `SELECT public.owner_beta_set_open(true)`);
  foundingCode = (await as<{ code: string }>(OWNER, `SELECT * FROM public.owner_beta_create_invites(2, 'Founder', 'email', 90)`))[0].code;
}, 60_000);

afterAll(() => db?.close());

describe("who can manage codes and promotions", () => {
  it("only admins", async () => {
    for (const q of [
      `SELECT * FROM public.owner_invite_list()`,
      `SELECT * FROM public.owner_invite_create(1)`,
      `SELECT public.owner_invite_revoke(gen_random_uuid(), 'nope')`,
      `SELECT public.owner_invite_set_label(gen_random_uuid(), 'x')`,
      `SELECT * FROM public.owner_invite_redemptions()`,
      `SELECT public.owner_promotions()`,
      `SELECT public.owner_promotion_save('{"name":"x"}')`,
      `SELECT public.owner_promotion_report(gen_random_uuid())`,
    ]) {
      expect(await fails(as(ALICE, q))).toMatch(/Not authorized/);
      expect(await fails(as(null, q))).toMatch(/permission denied/);
    }
    expect(await fails(as(ALICE, `SELECT public.code_redeem_for($1, 'abcd', false)`, [ALICE]))).toMatch(/permission denied/);
    // No grants in production, and row-level security with no policies either way.
    expect(await as(ALICE, `SELECT * FROM promotions`).catch(() => [])).toEqual([]);
    expect(await as(ALICE, `SELECT * FROM invite_redemptions`).catch(() => [])).toEqual([]);
  });
});

describe("plain invite codes", () => {
  it("single use by default, through sign-up", async () => {
    const [c] = await create({ label: "Sam" });
    expect(c.code).toMatch(/^[a-z0-9]{8}$/);
    expect(await state(c.code)).toEqual({ kind: "invite", state: "ok", plus_months: 0 });
    await signUp(ids[0], "sam", c.code.toUpperCase());
    expect(await state(c.code)).toMatchObject({ state: "used" });
    await signUp(ids[1], "sam2", c.code);
    const rows = await as<{ use_count: number; status: string; last_used_by_username: string }>(
      OWNER,
      `SELECT use_count, status, last_used_by_username FROM public.owner_invite_list() WHERE code = $1`,
      [c.code],
    );
    expect(rows).toEqual([{ use_count: 1, status: "used_up", last_used_by_username: "sam" }]);
    expect(await plan(ids[0])).toBe("free");
  });

  it("shared codes stop at their limit; one person can't use a code twice", async () => {
    const [c] = await create({ code: "Team-Code", uses: 2 });
    expect(c.code).toBe("team-code");
    expect(await redeem(ALICE, "TEAM-CODE")).toBe("ok");
    expect(await redeem(ALICE, "team-code")).toBe("already");
    await signUp(ids[2], "tee", "team-code");
    expect(await state("team-code")).toMatchObject({ state: "used" });
    expect(await redeem(ids[1], "team-code")).toBe("used");
    expect(
      (await as(OWNER, `SELECT * FROM public.owner_invite_redemptions($1)`, [c.id])).length,
    ).toBe(2);
  });

  it("custom codes are checked", async () => {
    expect(await fails(create({ code: "team-code" }))).toMatch(/already taken/);
    expect(await fails(create({ code: "fc-mine123" }))).toMatch(/can't start with fc-/);
    expect(await fails(create({ code: "ab" }))).toMatch(/4 to 40/);
    expect(await fails(create({ code: "abcd", count: 2 }))).toMatch(/one at a time/);
  });

  it("revoked and expired codes stop working", async () => {
    const [c] = await create({ uses: 10 });
    expect(await fails(as(OWNER, `SELECT public.owner_invite_revoke($1, '')`, [c.id]))).toMatch(/reason/);
    await as(OWNER, `SELECT public.owner_invite_revoke($1, 'posted publicly')`, [c.id]);
    expect(await redeem(ALICE, c.code)).toBe("revoked");
    const [e] = await create({ days: 1 });
    await svc(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [e.id]);
    expect(await state(e.code)).toMatchObject({ state: "expired" });
    expect(await redeem(ALICE, e.code)).toBe("expired");
    // Revoking never deletes: the row and its history stay.
    expect((await svc(`SELECT 1 FROM invites WHERE id = $1`, [c.id])).length).toBe(1);
  });

  it("the old direct delete can't remove a code that was used", async () => {
    const [{ id }] = await svc<{ id: string }>(`SELECT id FROM invites WHERE code = 'team-code'`);
    expect(await fails(as(OWNER, `DELETE FROM invites WHERE id = $1`, [id]))).toMatch(/foreign key|violates/);
  });
});

describe("promotions", () => {
  it("free Plus for new accounts, capped, reported", async () => {
    const p = await savePromo({
      name: "Launch week",
      plus_months: 1,
      eligibility: "new_accounts",
      max_redemptions: 2,
    });
    expect(p).toMatchObject({ state: "live", codes: 0, redemptions: 0 });
    const [c] = await create({ promo: p.id as string, code: "launch", uses: 100 });
    expect(await state("launch")).toEqual({ kind: "promotion", state: "ok", plus_months: 1 });
    // Existing accounts can't use a new-accounts promotion.
    expect(await redeem(ALICE, "launch")).toBe("new_only");
    await signUp(ids[3], "newbie", "launch");
    expect(await plan(ids[3])).toBe("plus");
    const [g] = await svc<{ days: number; auto_renew: boolean; source: string }>(
      `SELECT round(extract(epoch FROM ends_at - starts_at) / 86400)::int AS days, auto_renew, source
         FROM plan_entitlements WHERE user_id = $1`,
      [ids[3]],
    );
    expect(g.auto_renew).toBe(false);
    expect(g.source).toBe(`promo:${p.id}`);
    expect(g.days).toBeGreaterThanOrEqual(28);
    // A notice, not the Founding Member welcome email.
    expect(
      (await svc<{ kind: string }>(`SELECT kind FROM notifications WHERE user_id = $1`, [ids[3]])).map((r) => r.kind),
    ).toContain("promotion_plus");
    expect(
      (await svc(`SELECT 1 FROM email_outbox WHERE template = 'founding_member' AND user_id = $1`, [ids[3]]).catch(() => [])).length,
    ).toBe(0);
    await signUp(ids[4], "newbie2", "launch");
    await signUp(ids[5], "newbie3", "launch");
    expect(await plan(ids[5])).toBe("free"); // cap of 2 reached
    expect(await state("launch")).toMatchObject({ state: "full" });
    const report = (await as<{ r: { promotion: Record<string, number>; codes: { use_count: number }[]; daily: unknown[] } }>(
      OWNER,
      `SELECT public.owner_promotion_report($1) AS r`,
      [p.id],
    ))[0].r;
    expect(report.promotion).toMatchObject({ redemptions: 2, signups: 2, plus_now: 2, codes: 1 });
    expect(report.codes[0].use_count).toBe(2);
    expect(report.daily.length).toBe(30);
    expect(c.id).toBeTruthy();
  });

  it("paused, scheduled and ended promotions don't redeem; existing-only rules", async () => {
    const p = await savePromo({ name: "Loyal", plus_months: 0, eligibility: "existing_accounts", status: "paused" });
    await create({ promo: p.id as string, code: "loyal", uses: 50 });
    expect(await redeem(ALICE, "loyal")).toBe("paused");
    await savePromo({ ...p, status: "active", starts_at: new Date(Date.now() + 86400e3).toISOString() });
    expect(await redeem(ALICE, "loyal")).toBe("not_started");
    await savePromo({ ...p, status: "active", starts_at: null, ends_at: null });
    await signUp(ids[6], "fresh", "loyal");
    expect((await svc(`SELECT 1 FROM invite_redemptions WHERE user_id = $1`, [ids[6]])).length).toBe(0);
    expect(await redeem(ALICE, "loyal")).toBe("ok");
    await savePromo({ ...p, status: "ended" });
    expect(await redeem(ids[6], "loyal")).toBe("ended");
  });

  it("free months stack after a founding grant instead of overlapping", async () => {
    await signUp(ids[7], "founder", foundingCode);
    const p = await savePromo({ name: "Extra month", plus_months: 1 });
    await create({ promo: p.id as string, code: "extra-month", uses: 5 });
    expect(await redeem(ids[7], "extra-month")).toBe("ok");
    const rows = await svc<{ source: string; starts_at: Date; ends_at: Date }>(
      `SELECT source, starts_at, ends_at FROM plan_entitlements WHERE user_id = $1 ORDER BY starts_at`,
      [ids[7]],
    );
    expect(rows[0].source).toBe("founding_creator");
    expect(+rows[1].starts_at).toBe(+rows[0].ends_at);
  });
});

describe("Founding Member codes are unchanged", () => {
  it("still go through their own path, and only their label can be edited", async () => {
    expect(await state(foundingCode)).toEqual({ kind: "founding", state: "used" });
    const [other] = await svc<{ id: string; code: string; expires_at: Date }>(
      `SELECT id, code, expires_at FROM invites WHERE program IS NOT NULL AND used_by IS NULL`,
    );
    expect(await state(other.code)).toEqual({ kind: "founding", state: "ok" });
    await as(OWNER, `SELECT public.owner_invite_set_label($1, 'For Jo at the meetup')`, [other.id]);
    const [after] = await svc<{ label: string; code: string; expires_at: Date }>(
      `SELECT label, code, expires_at FROM invites WHERE id = $1`,
      [other.id],
    );
    expect(after).toEqual({ label: "For Jo at the meetup", code: other.code, expires_at: other.expires_at });
    expect(await fails(as(OWNER, `SELECT public.owner_invite_revoke($1, 'nope nope')`, [other.id]))).toMatch(/own page/);
    expect((await as(OWNER, `SELECT * FROM public.owner_invite_list() WHERE code = $1`, [other.code])).length).toBe(0);
    // Redeeming by the general entry point still gives the founding grant.
    expect(await redeem(ALICE, other.code)).toBe("ok");
    const [g] = await svc<{ source: string }>(
      `SELECT source FROM plan_entitlements WHERE user_id = $1 AND source = 'founding_creator'`,
      [ALICE],
    );
    expect(g.source).toBe("founding_creator");
  });
});

describe("rollback", () => {
  it("restores the schema and function bodies exactly", async () => {
    const MIG = "20261123020000_invites_promotions";
    const files = migrationSql();
    const all = (await import("node:fs")).readdirSync(join(__dirname, "..", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = all.indexOf(`${MIG}.sql`);
    expect(idx).toBeGreaterThan(-1);
    const fresh = new PGlite();
    try {
      await fresh.exec(SUPABASE_STUBS);
      await fresh.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
      for (const sql of files.slice(0, idx)) await fresh.exec(sql);
      await fresh.exec(SUPABASE_GRANTS);
      await fresh.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'o@x.test', '{"username":"boss"}')`, [OWNER]);
      await fresh.query(`INSERT INTO invites (code, created_by) VALUES ('plaincode', $1)`, [OWNER]);
      const snap = async () => {
        const f = await fresh.query<{ f: string }>(
          `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname, p.oid) AS f
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
        );
        const c = await fresh.query<{ c: string }>(
          `SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, ordinal_position) AS c
             FROM information_schema.columns WHERE table_schema = 'public'`,
        );
        const k = await fresh.query<{ k: string }>(
          `SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ',' ORDER BY conname) AS k
             FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
        );
        return [f.rows[0].f, c.rows[0].c, k.rows[0].k];
      };
      const before = await snap();
      // Later migrations roll back first, so this checks this one on its own.
      await fresh.exec(files[idx]);
      expect(await snap()).not.toEqual(before);
      const down = readFileSync(join(__dirname, "..", "rollbacks", `${MIG}.down.sql`), "utf8");
      {
        await fresh.exec(down);
        expect(await snap()).toEqual(before);
        await fresh.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@x.test', '{"username":"newbie","invite_code":"plaincode"}')`,
          [ALICE],
        );
        expect((await fresh.query(`SELECT used_by FROM invites`)).rows).toEqual([{ used_by: ALICE }]);
      }
    } finally {
      await fresh.close();
    }
  }, 60_000);
});
