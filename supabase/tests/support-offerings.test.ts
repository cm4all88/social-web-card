/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Support Offerings (issue #7) step 1 on in-memory Postgres with every real
 * migration applied: switched off by default, a real deliverable required,
 * versions that never change, owner approval per version, suspension, files
 * and posts kept from anyone who hasn't paid, privacy, audit and rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1"; // creator
const BOB = "00000000-0000-4000-8000-0000000000b1"; // buyer
const CARL = "00000000-0000-4000-8000-0000000000c1"; // visitor

const NEW_TABLES = [
  "support_offering_settings",
  "support_offerings",
  "support_offering_versions",
  "support_orders",
];

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
const one = async (who: string | null, q: string, p: unknown[] = []) =>
  (await as<{ r: any }>(who, q, p))[0].r;
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

const PACK = `${ALICE}/pack.pdf`;
const submit = (
  who: string,
  o: {
    id?: string | null;
    kind?: string;
    price?: number;
    path?: string | null;
    body?: string | null;
    title?: string;
  } = {},
) =>
  one(
    who,
    `SELECT public.creator_submit_support_offering($1, $2, $3, 'Twelve printable garden planners for the year.', 'A 24-page PDF you can print.', $4, true, $5, 'planner.pdf', $6) AS r`,
    [
      o.id ?? null,
      o.kind ?? "download",
      o.title ?? "Garden planner",
      o.price ?? 500,
      o.path === undefined ? PACK : o.path,
      o.body ?? null,
    ],
  );

const files = (who: string | null) =>
  as<{ n: number }>(
    who,
    `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'support-files' AND name = '${PACK}'`,
  ).then((r) => r[0].n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await db.exec(
    `REVOKE ALL ON ${NEW_TABLES.map((t) => `public.${t}`).join(", ")} FROM anon, authenticated`,
  );
  await db.exec(
    `GRANT USAGE ON SCHEMA storage TO anon, authenticated; GRANT ALL ON storage.objects TO authenticated; GRANT SELECT ON storage.objects TO anon;`,
  );
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await signUp(CARL, "carl");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('support-files', $1)`, [PACK]);
}, 60_000);

afterAll(() => db?.close());

describe("switched off", () => {
  it("starts off with checkout off, and hides everything from creators", async () => {
    const s = (await svc<any>(`SELECT * FROM support_offering_settings`))[0];
    expect([s.enabled, s.checkout_enabled]).toEqual([false, false]);
    expect(await one(ALICE, `SELECT public.my_support_offerings() AS r`)).toEqual({
      visible: false,
    });
    expect(await fails(submit(ALICE))).toMatch(/not available yet/i);
    expect((await one(OWNER, `SELECT public.my_support_offerings() AS r`)).visible).toBe(true);
  });
});

describe("offerings and versions", () => {
  let offeringId: string;

  beforeAll(async () => {
    await as(OWNER, `SELECT public.owner_set_support_offering_settings(true, null, null)`);
  });

  it("needs a real deliverable", async () => {
    expect(await fails(submit(ALICE, { path: null }))).toMatch(/upload the file/i);
    expect(await fails(submit(ALICE, { path: `${ALICE}/missing.pdf` }))).toMatch(/not found/i);
    expect(await fails(submit(ALICE, { path: `${BOB}/pack.pdf` }))).toMatch(/own upload/i);
    expect(await fails(submit(ALICE, { kind: "exclusive_post", body: "too short" }))).toMatch(
      /at least 50/i,
    );
    expect(await fails(submit(ALICE, { price: 10 }))).toMatch(/between \$1\.00 and \$500\.00/);
  });

  it("creates a pending version, and a change replaces only the pending one", async () => {
    const v1 = await submit(ALICE);
    offeringId = (
      await svc<{ offering_id: string }>(
        `SELECT offering_id FROM support_offering_versions WHERE id = $1`,
        [v1],
      )
    )[0].offering_id;
    await submit(ALICE, { id: offeringId, price: 600 });
    const rows = await svc<any>(
      `SELECT version, status FROM support_offering_versions WHERE offering_id = $1 ORDER BY version`,
      [offeringId],
    );
    expect(rows.map((r: any) => [r.version, r.status])).toEqual([
      [1, "withdrawn"],
      [2, "pending"],
    ]);
    expect(
      await fails(
        submit(BOB, {
          id: offeringId,
          kind: "exclusive_post",
          path: null,
          body: "Someone else's offering can't be changed by another account, ever.",
        }),
      ),
    ).toMatch(/offering not found/i);
  });

  it("owner approves a specific version; it can never be edited", async () => {
    const pending = (
      await svc<{ id: string }>(
        `SELECT id FROM support_offering_versions WHERE offering_id = $1 AND status = 'pending'`,
        [offeringId],
      )
    )[0].id;
    expect(
      await fails(as(ALICE, `SELECT public.owner_decide_support_version($1, true)`, [pending])),
    ).toMatch(/not authorized/i);
    expect(
      await fails(as(OWNER, `SELECT public.owner_decide_support_version($1, false)`, [pending])),
    ).toMatch(/reason/i);
    await as(OWNER, `SELECT public.owner_decide_support_version($1, true)`, [pending]);
    expect(
      await fails(
        svc(`UPDATE support_offering_versions SET min_price_cents = 1 WHERE id = $1`, [pending]),
      ),
    ).toMatch(/cannot be edited/i);
    expect(
      await fails(
        svc(`UPDATE support_offering_versions SET file_path = 'x/y' WHERE id = $1`, [pending]),
      ),
    ).toMatch(/cannot be edited/i);
    // A material change is a new version that needs approval; the approved one stays.
    await submit(ALICE, { id: offeringId, title: "Garden planner, second edition" });
    const mine = await one(ALICE, `SELECT public.my_support_offerings() AS r`);
    expect(mine.offerings[0].versions.map((v: any) => v.status)).toEqual(["pending", "approved"]);
    // The creator's own view never includes the file path or post text.
    expect(mine.offerings[0].versions[0].file_path).toBeUndefined();
    const next = mine.offerings[0].versions[0].id;
    await as(OWNER, `SELECT public.owner_decide_support_version($1, true)`, [next]);
    const statuses = await svc<any>(
      `SELECT status FROM support_offering_versions WHERE offering_id = $1 ORDER BY version`,
      [offeringId],
    );
    expect(statuses.map((r: any) => r.status)).toEqual(["withdrawn", "retired", "approved"]);
  });

  it("keeps the file from everyone but the creator, admins and paid buyers", async () => {
    expect(await files(null)).toBe(0);
    expect(await files(CARL)).toBe(0);
    expect(await files(BOB)).toBe(0);
    expect(await files(ALICE)).toBe(1);
    expect(await files(OWNER)).toBe(1);
    const version = (
      await svc<{ id: string }>(
        `SELECT id FROM support_offering_versions WHERE offering_id = $1 AND status = 'approved'`,
        [offeringId],
      )
    )[0].id;
    await svc(
      `INSERT INTO support_orders (version_id, creator_user_id, buyer_user_id, status, amount_cents, fee_cents)
       VALUES ($1, $2, $3, 'pending', 500, 50)`,
      [version, ALICE, BOB],
    );
    expect(await files(BOB)).toBe(0); // not paid yet
    await svc(`UPDATE support_orders SET status = 'paid'`);
    expect(await files(BOB)).toBe(1);
    await svc(`UPDATE support_orders SET status = 'refunded'`);
    expect(await files(BOB)).toBe(0);
    await svc(`UPDATE support_orders SET status = 'paid'`);
    const mine = await one(ALICE, `SELECT public.my_support_offerings() AS r`);
    expect(mine.offerings[0].sales).toBe(1);
  });

  it("owner can pause an offering; the creator can't change it while paused", async () => {
    expect(
      await fails(
        as(OWNER, `SELECT public.owner_set_support_offering_suspended($1, true)`, [offeringId]),
      ),
    ).toMatch(/reason/i);
    await as(OWNER, `SELECT public.owner_set_support_offering_suspended($1, true, 'Review')`, [
      offeringId,
    ]);
    expect(await fails(submit(ALICE, { id: offeringId }))).toMatch(/paused/i);
    await as(OWNER, `SELECT public.owner_set_support_offering_suspended($1, false)`, [offeringId]);
    const log = await svc<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE action LIKE 'support.%'`,
    );
    expect(log.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "support.version_approved",
        "support.offering_suspended",
        "support.offering_restored",
      ]),
    );
  });

  it("an exclusive post is kept in the database, not in a file", async () => {
    const body = "A long behind-the-scenes post about how I plan the garden every winter.";
    const id = await submit(ALICE, { kind: "exclusive_post", path: null, body });
    const row = (
      await svc<any>(
        `SELECT file_path, content_body FROM support_offering_versions WHERE id = $1`,
        [id],
      )
    )[0];
    expect(row.file_path).toBeNull();
    expect(row.content_body).toBe(body);
    const owner = await one(OWNER, `SELECT public.owner_support_offerings() AS r`);
    const found = owner.offerings.flatMap((o: any) => o.versions).find((v: any) => v.id === id);
    expect(found.content_body).toBe(body);
  });

  it("a creator can archive their own offering only", async () => {
    expect(
      (
        await as<{ r: boolean }>(BOB, `SELECT public.creator_archive_support_offering($1) AS r`, [
          offeringId,
        ])
      )[0].r,
    ).toBe(false);
    expect(
      (
        await as<{ r: boolean }>(ALICE, `SELECT public.creator_archive_support_offering($1) AS r`, [
          offeringId,
        ])
      )[0].r,
    ).toBe(true);
    const mine = await one(ALICE, `SELECT public.my_support_offerings() AS r`);
    expect(mine.offerings.map((o: any) => o.id)).not.toContain(offeringId);
  });
});

describe("privacy", () => {
  it("browsers can't read the new tables or call internal functions", async () => {
    for (const t of NEW_TABLES) {
      expect(await fails(as(BOB, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
      expect(await fails(as(null, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
    }
    expect(
      await fails(as(BOB, `SELECT public.support_version_unlocked(gen_random_uuid(), '${BOB}')`)),
    ).toMatch(/permission denied/i);
    expect(await fails(as(null, `SELECT public.my_support_offerings()`))).toMatch(
      /permission denied/i,
    );
    expect(await fails(as(BOB, `SELECT public.owner_support_offerings()`))).toMatch(
      /not authorized/i,
    );
  });

  it("leaves tips and tip settings alone", async () => {
    expect((await svc<{ t: string }>(`SELECT to_regclass('public.tip_settings')::text AS t`))[0].t).toBe(
      "tip_settings",
    );
  });
});

describe("rollback", () => {
  it("removes only what the migration added and keeps the audit log", async () => {
    const audit = (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n;
    await db.exec(
      readFileSync(join(__dirname, "../rollbacks/20261122210000_support_offerings.down.sql"), "utf8"),
    );
    for (const t of NEW_TABLES) {
      expect(
        (await svc<{ t: string | null }>(`SELECT to_regclass('public.${t}')::text AS t`))[0].t,
      ).toBeNull();
    }
    expect(
      (await svc<{ t: string | null }>(`SELECT to_regclass('public.tips')::text AS t`))[0].t,
    ).toBe("tips");
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n).toBe(
      audit,
    );
  });
});
