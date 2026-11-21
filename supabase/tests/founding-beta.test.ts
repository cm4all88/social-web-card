/**
 * Founding Creator Beta on in-memory Postgres with every real migration
 * applied: codes, the 50-seat cap, signup and later redemption, the 3-month
 * Plus grant that ends on its own with no renewal, feedback, who can do what,
 * and the audit log. No network.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1"; // existing account, redeems later
const BOB = "00000000-0000-4000-8000-0000000000b1"; // signs up with a code
const CAROL = "00000000-0000-4000-8000-0000000000c1"; // tries Bob's code again
const DAN = "00000000-0000-4000-8000-0000000000d1"; // suspended

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

const createCodes = (
  n: number,
  label: string | null = null,
  channel: string | null = null,
  days: number | null = null,
) =>
  as<{ id: string; code: string; expires_at: string }>(
    OWNER,
    `SELECT * FROM public.owner_beta_create_invites($1, $2, $3, $4)`,
    [n, label, channel, days],
  );
const overview = async () =>
  (
    await as<{ o: Record<string, number | boolean | string> }>(
      OWNER,
      `SELECT public.owner_beta_overview() AS o`,
    )
  )[0].o;
const grant = (uid: string) =>
  svc<{
    plan: string;
    via_signup: boolean;
    auto_renew: boolean;
    months: number;
    revoked_at: string | null;
  }>(
    `SELECT plan, via_signup, auto_renew, revoked_at,
            round(extract(epoch FROM ends_at - starts_at) / 86400)::int AS months
       FROM plan_entitlements WHERE user_id = $1`,
    [uid],
  );
const plan = async (uid: string) =>
  (await svc<{ p: string }>(`SELECT public.current_plan($1) AS p`, [uid]))[0].p;
const auditActions = async () =>
  (
    await svc<{ action: string; details: Record<string, unknown> }>(
      `SELECT action, details FROM admin_audit_log WHERE action LIKE 'beta.%' ORDER BY id`,
    )
  ).map((r) => r.action);

let bobsCode = "";

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
  await signUp(DAN, "dan");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await as(OWNER, `SELECT public.owner_set_suspended($1, true, 'spam account')`, [DAN]);
}, 60_000);

afterAll(() => db?.close());

describe("who can manage the beta", () => {
  it("only admins; signed-out visitors can't call the owner functions at all", async () => {
    for (const q of [
      `SELECT public.owner_beta_overview()`,
      `SELECT * FROM public.owner_beta_create_invites(1)`,
      `SELECT * FROM public.owner_beta_list_invites()`,
      `SELECT * FROM public.owner_beta_list_members()`,
      `SELECT * FROM public.owner_beta_list_feedback()`,
      `SELECT public.owner_beta_revoke_invite(gen_random_uuid(), 'nope')`,
      `SELECT public.owner_beta_revoke_grant('${ALICE}', 'nope')`,
    ]) {
      expect(await fails(as(ALICE, q))).toMatch(/Not authorized/);
      expect(await fails(as(null, q))).toMatch(/permission denied/);
    }
  });

  it("nobody, admins included, can write beta codes or grants directly", async () => {
    expect(
      await fails(
        as(
          OWNER,
          `INSERT INTO invites (code, created_by, program) VALUES ('fc-sneaky', $1, 'founding_creator')`,
          [OWNER],
        ),
      ),
    ).toMatch(/Founding beta page/);
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO plan_entitlements (user_id, plan, source, ends_at) VALUES ($1, 'plus', 'founding_creator', now() + interval '1 year')`,
          [ALICE],
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await fails(as(ALICE, `UPDATE beta_programs SET max_seats = 5000`))).toBeNull(); // RLS: no rows visible, nothing changes
    expect(
      (await svc<{ max_seats: number }>(`SELECT max_seats FROM beta_programs`))[0].max_seats,
    ).toBe(50);
  });

  it("the program starts with 50 seats and 3 months of Plus", async () => {
    const o = await overview();
    expect(o).toMatchObject({
      max_seats: 50,
      plus_months: 3,
      open: true,
      seats_left: 50,
      codes_created: 0,
    });
  });
});

describe("codes", () => {
  it("are unique, unguessable-looking, labelled, and expire", async () => {
    const codes = await createCodes(3, "Instagram: a photographer", "dm", 14);
    expect(codes).toHaveLength(3);
    expect(new Set(codes.map((c) => c.code)).size).toBe(3);
    for (const c of codes) expect(c.code).toMatch(/^fc-[a-hjkmnp-z2-9]{10}$/);
    const days = (Date.parse(codes[0].expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const list = await as<{ label: string; channel: string; status: string }>(
      OWNER,
      `SELECT * FROM owner_beta_list_invites()`,
    );
    expect(list).toHaveLength(3);
    expect(
      list.every(
        (r) => r.status === "open" && r.channel === "dm" && r.label === "Instagram: a photographer",
      ),
    ).toBe(true);
    bobsCode = codes[0].code;
  });

  it("reject bad input", async () => {
    expect(await fails(createCodes(0))).toMatch(/between 1 and 10/);
    expect(await fails(createCodes(11))).toMatch(/between 1 and 10/);
    expect(await fails(createCodes(1, null, "sms"))).toMatch(/Channel/);
    expect(await fails(createCodes(1, null, null, 365))).toMatch(/1 to 180 days/);
  });

  it("tell a visitor whether a code works, without saying whose it is", async () => {
    expect(
      (await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [bobsCode]))[0].s,
    ).toBe("ok");
    expect(
      (
        await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [bobsCode.toUpperCase()])
      )[0].s,
    ).toBe("ok");
    expect(
      (await as<{ s: string }>(null, `SELECT beta_code_state('fc-nosuchcode') AS s`))[0].s,
    ).toBe("invalid");
    expect((await as<{ s: string }>(null, `SELECT beta_code_state('') AS s`))[0].s).toBe("invalid");
  });
});

describe("signing up with a code", () => {
  it("gives 3 months of Plus that can't renew, and uses the code", async () => {
    await signUp(BOB, "bob", bobsCode);
    const [g] = await grant(BOB);
    expect(g).toMatchObject({
      plan: "plus",
      via_signup: true,
      auto_renew: false,
      revoked_at: null,
    });
    expect(g.months).toBeGreaterThanOrEqual(89);
    expect(g.months).toBeLessThanOrEqual(92);
    expect(await plan(BOB)).toBe("plus");
    const [inv] = await svc<{ used_by: string }>(`SELECT used_by FROM invites WHERE code = $1`, [
      bobsCode,
    ]);
    expect(inv.used_by).toBe(BOB);
    expect(
      (await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [bobsCode]))[0].s,
    ).toBe("used");
  });

  it("a used, unknown or expired code still lets someone sign up, on the free plan", async () => {
    await signUp(CAROL, "carol", bobsCode);
    expect(await grant(CAROL)).toHaveLength(0);
    expect(await plan(CAROL)).toBe("free");
    expect((await svc(`SELECT 1 FROM profiles WHERE user_id = $1`, [CAROL])).length).toBe(1);

    const [exp] = await createCodes(1);
    await db.exec(`SET yooits.beta_write = 'on'`);
    await svc(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      exp.id,
    ]);
    await db.exec(`RESET yooits.beta_write`);
    const EVE = "00000000-0000-4000-8000-0000000000e1";
    await signUp(EVE, "eve", exp.code);
    expect(await grant(EVE)).toHaveLength(0);
    const NOBODY = "00000000-0000-4000-8000-0000000000e2";
    await signUp(NOBODY, "nobody", "fc-madeupcode1");
    expect(await grant(NOBODY)).toHaveLength(0);
  });

  it("plain (non-beta) invites work exactly as before", async () => {
    await as(OWNER, `INSERT INTO invites (code, created_by) VALUES ('plaincode1', $1)`, [OWNER]);
    const FRANK = "00000000-0000-4000-8000-0000000000f1";
    await signUp(FRANK, "frank", "plaincode1");
    expect(
      (await svc<{ used_by: string }>(`SELECT used_by FROM invites WHERE code = 'plaincode1'`))[0]
        .used_by,
    ).toBe(FRANK);
    expect(await grant(FRANK)).toHaveLength(0);
    await as(OWNER, `DELETE FROM invites WHERE code = 'plaincode1'`);
  });
});

describe("redeeming while signed in", () => {
  it("works once per account, and not for suspended accounts", async () => {
    const [a, b] = await createCodes(2);
    expect(
      (await as<{ r: string }>(ALICE, `SELECT redeem_beta_invite($1) AS r`, [a.code]))[0].r,
    ).toBe("ok");
    expect((await grant(ALICE))[0]).toMatchObject({ via_signup: false, plan: "plus" });
    expect(
      (await as<{ r: string }>(ALICE, `SELECT redeem_beta_invite($1) AS r`, [b.code]))[0].r,
    ).toBe("already");
    expect(
      (await as<{ r: string }>(DAN, `SELECT redeem_beta_invite($1) AS r`, [b.code]))[0].r,
    ).toBe("invalid");
    expect((await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [b.code]))[0].s).toBe(
      "ok",
    ); // b still unused
    expect(await fails(as(null, `SELECT redeem_beta_invite($1)`, [b.code]))).toMatch(
      /permission denied/,
    );
  });

  it("people see only their own grant", async () => {
    expect(await as(ALICE, `SELECT user_id FROM plan_entitlements`)).toEqual([{ user_id: ALICE }]);
    expect(await as(CAROL, `SELECT user_id FROM plan_entitlements`)).toEqual([]);
    expect((await as(OWNER, `SELECT user_id FROM plan_entitlements`)).length).toBe(2);
    expect(await fails(as(ALICE, `SELECT public.current_plan($1)`, [ALICE]))).toMatch(
      /permission denied/,
    );
  });
});

describe("the grant ends on its own", () => {
  it("reads free after ends_at, can never be set to auto-renew, and charges nothing", async () => {
    expect(
      await fails(svc(`UPDATE plan_entitlements SET auto_renew = true WHERE user_id = $1`, [BOB])),
    ).toMatch(/check constraint/);
    await svc(
      `UPDATE plan_entitlements SET starts_at = now() - interval '4 months', ends_at = now() - interval '1 day' WHERE user_id = $1`,
      [BOB],
    );
    expect(await plan(BOB)).toBe("free");
    const members = await as<{ username: string; status: string }>(
      OWNER,
      `SELECT username, status FROM owner_beta_list_members()`,
    );
    expect(members.find((m) => m.username === "bob")?.status).toBe("ended");
    // Put Bob back for the later checks.
    await svc(
      `UPDATE plan_entitlements SET starts_at = now(), ends_at = now() + interval '3 months' WHERE user_id = $1`,
      [BOB],
    );
  });
});

describe("the 50-seat cap", () => {
  it("counts active grants plus open codes, and revoking frees a seat", async () => {
    let o = await overview();
    const taken = 50 - Number(o.seats_left);
    // 2 grants (Bob, Alice) + open codes (2 of the first 3, and Alice's spare).
    expect(taken).toBe(2 + Number(o.codes_open));

    const left = Number(o.seats_left);
    for (let n = left; n > 0; n -= Math.min(n, 10)) await createCodes(Math.min(n, 10));
    o = await overview();
    expect(o.seats_left).toBe(0);
    expect(await fails(createCodes(1))).toMatch(/Only 0 of 50 seats are left/);

    const [open] = (
      await as<{ id: string; status: string }>(
        OWNER,
        `SELECT id, status FROM owner_beta_list_invites(200)`,
      )
    ).filter((r) => r.status === "open");
    expect(await fails(as(OWNER, `SELECT owner_beta_revoke_invite($1, 'x')`, [open.id]))).toMatch(
      /short reason/,
    );
    await as(OWNER, `SELECT owner_beta_revoke_invite($1, 'sent to the wrong person')`, [open.id]);
    expect((await overview()).seats_left).toBe(1);
    expect(
      await fails(as(OWNER, `SELECT owner_beta_revoke_invite($1, 'again please')`, [open.id])),
    ).toMatch(/unused, active/);
    await createCodes(1);
    expect((await overview()).seats_left).toBe(0);
  });

  it("can't be passed by redeeming when every seat is held by a grant", async () => {
    await svc(`UPDATE beta_programs SET max_seats = 2`); // Bob + Alice already hold 2
    const [spare] = (
      await as<{ code: string; status: string }>(
        OWNER,
        `SELECT code, status FROM owner_beta_list_invites(200)`,
      )
    ).filter((r) => r.status === "open");
    expect(
      (await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [spare.code]))[0].s,
    ).toBe("full");
    expect(
      (await as<{ r: string }>(CAROL, `SELECT redeem_beta_invite($1) AS r`, [spare.code]))[0].r,
    ).toBe("full");
    expect(await grant(CAROL)).toHaveLength(0);

    // Ending Bob's grant frees his seat for Carol.
    expect(await fails(as(OWNER, `SELECT owner_beta_revoke_grant($1, 'no')`, [BOB]))).toMatch(
      /short reason/,
    );
    await as(OWNER, `SELECT owner_beta_revoke_grant($1, 'not a real creator')`, [BOB]);
    expect(await plan(BOB)).toBe("free");
    expect(
      (await as<{ r: string }>(CAROL, `SELECT redeem_beta_invite($1) AS r`, [spare.code]))[0].r,
    ).toBe("ok");
    expect(await plan(CAROL)).toBe("plus");
    await svc(`UPDATE beta_programs SET max_seats = 50`);
  });

  it("stops new codes and redemptions when the program is closed", async () => {
    await svc(`UPDATE beta_programs SET open = false`);
    expect(await fails(createCodes(1))).toMatch(/closed/);
    const [spare] = (
      await as<{ code: string; status: string }>(
        OWNER,
        `SELECT code, status FROM owner_beta_list_invites(200)`,
      )
    ).filter((r) => r.status === "open");
    expect(
      (await as<{ s: string }>(null, `SELECT beta_code_state($1) AS s`, [spare.code]))[0].s,
    ).toBe("closed");
    await svc(`UPDATE beta_programs SET open = true`);
  });
});

describe("feedback", () => {
  it("people send their own notes and read only their own", async () => {
    await as(
      ALICE,
      `INSERT INTO beta_feedback (rating, message) VALUES (5, '  Love the themes  ')`,
    );
    await as(CAROL, `INSERT INTO beta_feedback (message) VALUES ('Wishlist images are slow')`);
    expect(
      await fails(
        as(ALICE, `INSERT INTO beta_feedback (user_id, message) VALUES ($1, 'pretending')`, [
          CAROL,
        ]),
      ),
    ).toMatch(/row-level security/);
    expect(
      await fails(as(ALICE, `INSERT INTO beta_feedback (rating, message) VALUES (9, 'eleven')`)),
    ).toMatch(/check constraint/);
    expect(await fails(as(ALICE, `INSERT INTO beta_feedback (message) VALUES (' ')`))).toMatch(
      /check constraint/,
    );
    expect(
      await fails(as(DAN, `INSERT INTO beta_feedback (message) VALUES ('suspended note')`)),
    ).toMatch(/row-level security/);
    expect(
      await fails(as(null, `INSERT INTO beta_feedback (message) VALUES ('anon note')`)),
    ).toMatch(/row-level security|permission denied|null value/);
    expect(await as(ALICE, `SELECT message FROM beta_feedback`)).toEqual([
      { message: "Love the themes" },
    ]);
    expect(await fails(as(ALICE, `UPDATE beta_feedback SET message = 'changed'`))).toBeNull();
    expect(
      (
        await svc<{ message: string }>(`SELECT message FROM beta_feedback WHERE user_id = $1`, [
          ALICE,
        ])
      )[0].message,
    ).toBe("Love the themes");
  });

  it("is limited to 10 notes a day per person", async () => {
    for (let i = 0; i < 9; i++)
      await as(CAROL, `INSERT INTO beta_feedback (message) VALUES ('note ${i}')`);
    expect(
      await fails(as(CAROL, `INSERT INTO beta_feedback (message) VALUES ('one too many')`)),
    ).toMatch(/plenty of feedback/);
  });

  it("the owner sees all of it, newest first, marked by whether the sender is in the beta", async () => {
    const rows = await as<{ username: string; in_beta: boolean; message: string }>(
      OWNER,
      `SELECT * FROM owner_beta_list_feedback(5)`,
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ username: "carol", in_beta: true });
  });
});

describe("owner console numbers and the audit log", () => {
  it("overview and members add up", async () => {
    await svc(`UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1`, [ALICE]);
    const o = await overview();
    expect(o).toMatchObject({
      signups: 1,
      existing_redeemed: 2,
      plus_now: 2,
      active_14d: 1,
      grants_revoked: 1,
      feedback: 11,
    });
    const members = await as<{
      username: string;
      status: string;
      via_signup: boolean;
      feedback_count: number;
      email: string;
    }>(OWNER, `SELECT * FROM owner_beta_list_members()`);
    expect(Object.fromEntries(members.map((m) => [m.username, m.status]))).toEqual({
      alice: "active",
      bob: "revoked",
      carol: "quiet",
    });
    expect(members.find((m) => m.username === "alice")).toMatchObject({
      email: "alice@example.test",
      feedback_count: 1,
    });
  });

  it("every privileged step is logged, and codes themselves never are", async () => {
    const actions = await auditActions();
    expect(actions).toContain("beta.codes_created");
    expect(actions).toContain("beta.code_revoked");
    expect(actions).toContain("beta.grant_revoked");
    expect(actions.filter((a) => a === "beta.redeemed")).toHaveLength(3); // Bob, Alice, Carol
    const codes = (
      await svc<{ code: string }>(`SELECT code FROM invites WHERE program IS NOT NULL`)
    ).map((r) => r.code);
    const log = JSON.stringify(await svc(`SELECT details FROM admin_audit_log`));
    for (const c of codes) expect(log).not.toContain(c);
    const [revoked] = await svc<{ actor_user_id: string; reason: string }>(
      `SELECT actor_user_id, details->>'reason' AS reason FROM admin_audit_log WHERE action = 'beta.grant_revoked'`,
    );
    expect(revoked).toEqual({ actor_user_id: OWNER, reason: "not a real creator" });
  });
});

describe("applying the migration to a database that already has users and invites", () => {
  it("leaves existing invites and accounts as they were", async () => {
    const MIGRATIONS = join(__dirname, "..", "migrations");
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const beta = files.findIndex((f) => f.startsWith("20261121230000"));
    const fresh = new PGlite();
    try {
      await fresh.exec(SUPABASE_STUBS);
      await fresh.exec(
        `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
      );
      for (const f of files.slice(0, beta))
        await fresh.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      await fresh.exec(SUPABASE_GRANTS);
      await fresh.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'o@x.test', '{"username":"boss"}')`,
        [OWNER],
      );
      await fresh.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
      await fresh.query(
        `INSERT INTO invites (code, created_by) VALUES ('oldcode1', $1), ('oldcode2', $1)`,
        [OWNER],
      );
      const before = (await fresh.query(`SELECT id, code, used_by FROM invites ORDER BY code`))
        .rows;
      for (const f of files.slice(beta))
        await fresh.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      await fresh.exec(SUPABASE_GRANTS);
      expect(
        (await fresh.query(`SELECT id, code, used_by FROM invites ORDER BY code`)).rows,
      ).toEqual(before);
      expect(
        (await fresh.query(`SELECT program FROM invites WHERE program IS NOT NULL`)).rows,
      ).toEqual([]);
      expect((await fresh.query(`SELECT count(*)::int AS n FROM profiles`)).rows).toEqual([
        { n: 1 },
      ]);
      // Signup still works with an old plain code.
      await fresh.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@x.test', '{"username":"newbie","invite_code":"oldcode1"}')`,
        [ALICE],
      );
      expect(
        (await fresh.query(`SELECT used_by FROM invites WHERE code = 'oldcode1'`)).rows,
      ).toEqual([{ used_by: ALICE }]);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});
