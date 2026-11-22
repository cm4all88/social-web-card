/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Creator earnings step 1 on in-memory Postgres with every real migration
 * applied: qualifying visitors (own visits, refreshes and suspicious traffic
 * left out), configurable milestones, the admin-only switch, privacy of the
 * new tables, and the rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** A profile view at a given time, written straight into the events table. */
const view = (owner: string, visitor: string | null, at = "now()") =>
  svc(
    `INSERT INTO analytics_events (kind, profile_user_id, visitor_hash, occurred_at)
     VALUES ('profile_view', $1, $2, ${at})`,
    [owner, visitor],
  );
const count = (user: string) =>
  svc<{ n: number }>(`SELECT public.creator_qualifying_visitors($1) AS n`, [user]).then(
    (r) => r[0].n,
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
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  // As in Supabase: new tables get default grants, then the migration's REVOKE applies.
  await db.exec(
    `REVOKE ALL ON public.creator_earnings_settings, public.creator_milestones, public.creator_presence FROM anon, authenticated`,
  );
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 60_000);

afterAll(() => db?.close());

describe("qualifying visitors", () => {
  it("counts each visitor once a day, however often they refresh", async () => {
    await view(ALICE, "v1");
    await view(ALICE, "v1");
    await view(ALICE, "v1");
    await view(ALICE, "v2");
    await view(ALICE, "v1", "now() - interval '2 days'");
    expect(await count(ALICE)).toBe(3);
  });

  it("leaves out views with no visitor hash", async () => {
    await view(ALICE, null);
    expect(await count(ALICE)).toBe(3);
  });

  it("leaves out the creator's own browser on days they used the dashboard", async () => {
    await view(ALICE, "alice-phone");
    expect(await count(ALICE)).toBe(4);
    await svc(`SELECT public.record_creator_presence($1, 'alice-phone')`, [ALICE]);
    await svc(`SELECT public.record_creator_presence($1, 'alice-phone')`, [ALICE]); // no duplicate
    expect(await count(ALICE)).toBe(3);
    // The same browser still counts on Bob's page: it's only Alice's own visit.
    await view(BOB, "alice-phone");
    expect(await count(BOB)).toBe(1);
  });

  it("leaves out a visitor that viewed too many pages that day", async () => {
    await svc(`UPDATE creator_earnings_settings SET suspicious_pages_per_day = 2`);
    await view(ALICE, "crawler");
    await view(BOB, "crawler");
    expect(await count(ALICE)).toBe(4);
    await view(OWNER, "crawler");
    expect(await count(ALICE)).toBe(3);
    await svc(`UPDATE creator_earnings_settings SET suspicious_pages_per_day = 30`);
  });

  it("leaves out a visitor that sent too many events that day", async () => {
    await svc(`UPDATE creator_earnings_settings SET suspicious_events_per_day = 10`);
    for (let i = 0; i < 11; i++) {
      await svc(
        `INSERT INTO analytics_events (kind, profile_user_id, visitor_hash) VALUES ('link_click', $1, 'spammy')`,
        [BOB],
      );
    }
    await view(ALICE, "spammy");
    const n = await count(ALICE);
    await svc(`UPDATE creator_earnings_settings SET suspicious_events_per_day = 200`);
    expect(n).toBe((await count(ALICE)) - 1);
  });
});

describe("milestones", () => {
  it("seeds the four proposed milestones, all not live", async () => {
    const rows = await svc<{ key: string; threshold: number; live: boolean }>(
      `SELECT key, threshold, live FROM creator_milestones ORDER BY threshold`,
    );
    expect(rows.map((r) => [r.key, r.threshold])).toEqual([
      ["exclusive_skin", 100],
      ["more_customization", 500],
      ["subscriptions_apply", 1000],
      ["creator_features", 5000],
    ]);
    expect(rows.every((r) => !r.live)).toBe(true);
  });

  it("a milestone that isn't live is never reached, whatever the count", async () => {
    await as(
      OWNER,
      `SELECT public.owner_set_creator_milestone('exclusive_skin', 2, 'Skin', 'A skin', false)`,
    );
    const reached = (key: string) =>
      svc<{ r: boolean }>(`SELECT public.creator_milestone_reached($1, $2) AS r`, [
        ALICE,
        key,
      ]).then((r) => r[0].r);
    expect(await reached("exclusive_skin")).toBe(false);
    await as(
      OWNER,
      `SELECT public.owner_set_creator_milestone('exclusive_skin', 2, 'Skin', 'A skin', true)`,
    );
    expect(await reached("exclusive_skin")).toBe(true);
    await as(
      OWNER,
      `SELECT public.owner_set_creator_milestone('exclusive_skin', 9999, 'Skin', 'A skin', true)`,
    );
    expect(await reached("exclusive_skin")).toBe(false);
    expect(await reached("no_such_key")).toBe(false);
    await as(
      OWNER,
      `SELECT public.owner_set_creator_milestone('exclusive_skin', 100, 'Exclusive profile skin', 'A skin', false)`,
    );
  });

  it("only an admin can change milestones or settings, and every change is logged", async () => {
    expect(
      await fails(
        as(ALICE, `SELECT public.owner_set_creator_milestone('exclusive_skin', 1, 'x', 'y', true)`),
      ),
    ).toMatch(/not authorized/i);
    expect(await fails(as(ALICE, `SELECT public.owner_set_creator_earnings(true)`))).toMatch(
      /not authorized/i,
    );
    expect(await fails(as(null, `SELECT public.owner_creator_earnings()`))).toMatch(
      /permission denied/i,
    );
    expect(
      await fails(
        as(OWNER, `SELECT public.owner_set_creator_milestone('nope', 1, 'x', 'y', true)`),
      ),
    ).toMatch(/unknown milestone/i);
    const log = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'creator_earnings.milestone'`,
    );
    expect(log[0].n).toBe(4);
  });
});

describe("visibility and privacy", () => {
  it("is hidden from creators while off, shown to admins", async () => {
    expect((await as<{ r: any }>(ALICE, `SELECT public.my_creator_earnings() AS r`))[0].r).toEqual({
      visible: false,
    });
    const admin = (await as<{ r: any }>(OWNER, `SELECT public.my_creator_earnings() AS r`))[0].r;
    expect(admin.visible).toBe(true);
    expect(admin.enabled).toBe(false);
    expect(admin.milestones).toHaveLength(4);
  });

  it("shows a creator their own count once switched on", async () => {
    await as(OWNER, `SELECT public.owner_set_creator_earnings(true)`);
    const mine = (await as<{ r: any }>(ALICE, `SELECT public.my_creator_earnings() AS r`))[0].r;
    expect(mine.visible).toBe(true);
    expect(mine.qualifying_visitors).toBe(await count(ALICE));
    expect(mine.milestones[0]).toMatchObject({
      key: "exclusive_skin",
      live: false,
      reached: false,
    });
    await as(OWNER, `SELECT public.owner_set_creator_earnings(false)`);
  });

  it("browsers can't read the new tables or call the internal functions", async () => {
    for (const t of ["creator_earnings_settings", "creator_milestones", "creator_presence"]) {
      expect(await fails(as(ALICE, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
      expect(await fails(as(null, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
    }
    expect(await fails(as(ALICE, `SELECT public.creator_qualifying_visitors('${BOB}')`))).toMatch(
      /permission denied/i,
    );
    expect(
      await fails(as(ALICE, `SELECT public.record_creator_presence('${ALICE}', 'x')`)),
    ).toMatch(/permission denied/i);
    expect(
      await fails(
        as(ALICE, `SELECT public.creator_milestone_reached('${ALICE}', 'exclusive_skin')`),
      ),
    ).toMatch(/permission denied/i);
    expect(await fails(as(null, `SELECT public.my_creator_earnings()`))).toMatch(
      /permission denied/i,
    );
  });

  it("a deleted account takes its presence rows with it", async () => {
    await svc(`DELETE FROM auth.users WHERE id = $1`, [BOB]);
    await svc(`SELECT public.record_creator_presence($1, 'x')`, [ALICE]);
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM creator_presence`))[0].n).toBe(
      2,
    );
  });
});

describe("rollback", () => {
  it("removes only what the migration added and keeps analytics and audit rows", async () => {
    const events = (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events`))[0]
      .n;
    const audit = (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n;
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261122190000_creator_earnings.down.sql"),
        "utf8",
      ),
    );
    expect(
      (
        await svc<{ t: string | null }>(
          `SELECT to_regclass('public.creator_milestones')::text AS t`,
        )
      )[0].t,
    ).toBeNull();
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events`))[0].n).toBe(
      events,
    );
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n).toBe(
      audit,
    );
  });
});
