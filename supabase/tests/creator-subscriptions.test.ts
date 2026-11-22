/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Creator subscriptions step 2 on in-memory Postgres with every real migration
 * applied: switched off by default, apply only after the milestone and 18+,
 * owner approval and suspension, versioned offers within the price limits,
 * subscriber-only posts locked on the server and in private storage, privacy
 * of the new tables, the audit log, and the rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1"; // creator
const BOB = "00000000-0000-4000-8000-0000000000b1"; // subscriber
const CARL = "00000000-0000-4000-8000-0000000000c1"; // visitor

const NEW_TABLES = [
  "creator_subscription_settings",
  "creator_applications",
  "creator_monetization",
  "creator_subscription_offers",
  "creator_subscriptions",
  "creator_posts",
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

const apply = (who: string, adult = true) =>
  as(
    who,
    `SELECT public.creator_apply('I post photo updates from my garden every week.', ARRAY['photos','updates'], $1, true) AS r`,
    [adult],
  );

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
    `REVOKE ALL ON ${NEW_TABLES.map((t) => `public.${t}`).join(", ")}, public.creator_earnings_settings, public.creator_milestones, public.creator_presence FROM anon, authenticated`,
  );
  await db.exec(
    `GRANT USAGE ON SCHEMA storage TO anon, authenticated; GRANT ALL ON storage.objects TO authenticated; GRANT SELECT ON storage.objects TO anon;`,
  );
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await signUp(CARL, "carl");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 60_000);

afterAll(() => db?.close());

describe("switched off", () => {
  it("starts off, with checkout off and no fee rates", async () => {
    const s = (await svc<any>(`SELECT * FROM creator_subscription_settings`))[0];
    expect(s.enabled).toBe(false);
    expect(s.checkout_enabled).toBe(false);
    expect([
      s.yooits_percent_bps,
      s.yooits_fixed_cents,
      s.stripe_percent_bps,
      s.stripe_fixed_cents,
    ]).toEqual([null, null, null, null]);
  });

  it("hides everything from creators and visitors while off", async () => {
    expect(await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`)).toEqual({
      visible: false,
    });
    expect(await one(null, `SELECT public.creator_feed('alice') AS r`)).toEqual({
      enabled: false,
      posts: [],
    });
    expect(await fails(apply(ALICE))).toMatch(/not available yet/i);
    const admin = await one(OWNER, `SELECT public.my_creator_subscriptions() AS r`);
    expect(admin.visible).toBe(true);
    expect(admin.fees).toBeNull();
  });
});

describe("applications", () => {
  beforeAll(async () => {
    await as(
      OWNER,
      `SELECT public.owner_set_creator_subscription_settings(true, null, null, null, null, null, null)`,
    );
  });

  it("needs the visitor milestone", async () => {
    expect(await fails(apply(ALICE))).toMatch(/visitor milestone/i);
    // The milestone must be live and reached.
    await as(
      OWNER,
      `SELECT public.owner_set_creator_milestone('subscriptions_apply', 1, 'Apply', 'Apply for subscriptions', true)`,
    );
    await svc(
      `INSERT INTO analytics_events (kind, profile_user_id, visitor_hash) VALUES ('profile_view', $1, 'v1')`,
      [ALICE],
    );
    expect((await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`)).can_apply).toBe(
      true,
    );
  });

  it("needs 18+ and keeps one open application", async () => {
    expect(await fails(apply(ALICE, false))).toMatch(/18 or older/i);
    await apply(ALICE);
    expect(await fails(apply(ALICE))).toMatch(/already waiting/i);
    const mine = await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`);
    expect(mine.application.status).toBe("pending");
    expect(mine.monetization).toBeNull();
  });

  it("only the owner decides, a rejection needs a reason, and both are logged", async () => {
    const appId = (
      await svc<{ id: string }>(`SELECT id FROM creator_applications WHERE user_id = $1`, [ALICE])
    )[0].id;
    expect(
      await fails(as(ALICE, `SELECT public.owner_decide_creator_application($1, true)`, [appId])),
    ).toMatch(/not authorized/i);
    expect(
      await fails(as(OWNER, `SELECT public.owner_decide_creator_application($1, false)`, [appId])),
    ).toMatch(/reason/i);
    await as(OWNER, `SELECT public.owner_decide_creator_application($1, true, 'Welcome')`, [appId]);
    const mine = await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`);
    expect(mine.application.status).toBe("approved");
    expect(mine.monetization.suspended).toBe(false);
    const log = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'creator.application_approved'`,
    );
    expect(log[0].n).toBe(1);
  });
});

describe("offers", () => {
  it("keeps the price inside the owner's limits", async () => {
    expect(
      await fails(
        as(ALICE, `SELECT public.creator_submit_offer(10, 'Weekly garden photos and notes')`),
      ),
    ).toMatch(/between \$1\.00 and \$500\.00/);
    expect(
      await fails(
        as(BOB, `SELECT public.creator_submit_offer(500, 'Weekly garden photos and notes')`),
      ),
    ).toMatch(/not approved/i);
  });

  it("versions offers, and an approved version can't be edited", async () => {
    await as(ALICE, `SELECT public.creator_submit_offer(500, 'Weekly garden photos and notes')`);
    await as(ALICE, `SELECT public.creator_submit_offer(600, 'Weekly garden photos and notes')`);
    const rows = await svc<any>(
      `SELECT id, version, price_cents, status FROM creator_subscription_offers WHERE user_id = $1 ORDER BY version`,
      [ALICE],
    );
    expect(rows.map((r: any) => [r.version, r.status])).toEqual([
      [1, "withdrawn"],
      [2, "pending"],
    ]);
    await as(OWNER, `SELECT public.owner_decide_creator_offer($1, true)`, [rows[1].id]);
    expect(
      await fails(
        svc(`UPDATE creator_subscription_offers SET price_cents = 1 WHERE id = $1`, [rows[1].id]),
      ),
    ).toMatch(/cannot be edited/i);
    // A new version waits for review while the approved one stays.
    await as(ALICE, `SELECT public.creator_submit_offer(700, 'Weekly garden photos and notes')`);
    const pending = (
      await svc<{ id: string }>(
        `SELECT id FROM creator_subscription_offers WHERE user_id = $1 AND status = 'pending'`,
        [ALICE],
      )
    )[0].id;
    await as(OWNER, `SELECT public.owner_decide_creator_offer($1, true)`, [pending]);
    const statuses = await svc<any>(
      `SELECT version, status FROM creator_subscription_offers WHERE user_id = $1 ORDER BY version`,
      [ALICE],
    );
    expect(statuses.map((r: any) => r.status)).toEqual(["withdrawn", "retired", "approved"]);
  });
});

describe("posts and access", () => {
  let publicId: string;
  let paidId: string;

  beforeAll(async () => {
    publicId = await one(
      ALICE,
      `SELECT public.creator_save_post(null, 'public', 'Hello', 'Public body', null, '{}') AS r`,
    );
    paidId = await one(
      ALICE,
      `SELECT public.creator_save_post(null, 'subscribers', 'Members only', 'Secret body', 'A peek', ARRAY['${ALICE}/rose.jpg']) AS r`,
    );
    await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('creator-media', $1)`, [
      `${ALICE}/rose.jpg`,
    ]);
  });

  const feed = (who: string | null) => one(who, `SELECT public.creator_feed('alice') AS r`);
  const media = (who: string | null) =>
    as<{ n: number }>(
      who,
      `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'creator-media'`,
    ).then((r) => r[0].n);

  it("can't attach another person's files", async () => {
    expect(
      await fails(
        as(
          ALICE,
          `SELECT public.creator_save_post(null, 'public', 'x', '', null, ARRAY['${BOB}/a.jpg'])`,
        ),
      ),
    ).toMatch(/own uploads/i);
  });

  it("shows visitors only the title and preview of a subscriber post", async () => {
    for (const who of [null, CARL]) {
      const f = await feed(who);
      const paid = f.posts.find((p: any) => p.id === paidId);
      expect(paid).toMatchObject({
        locked: true,
        title: "Members only",
        preview: "A peek",
        media_count: 1,
      });
      expect(paid.body).toBeUndefined();
      expect(paid.media_paths).toBeUndefined();
      expect(f.posts.find((p: any) => p.id === publicId)).toMatchObject({
        locked: false,
        body: "Public body",
      });
      expect(await media(who)).toBe(0);
    }
  });

  it("unlocks for an active subscriber only, in the feed and in storage", async () => {
    await svc(
      `INSERT INTO creator_subscriptions (subscriber_user_id, creator_user_id, status, price_cents, fee_cents, current_period_end)
       VALUES ($1, $2, 'active', 700, 0, now() + interval '20 days')`,
      [BOB, ALICE],
    );
    const f = await feed(BOB);
    expect(f.subscribed).toBe(true);
    expect(f.posts.find((p: any) => p.id === paidId)).toMatchObject({
      locked: false,
      body: "Secret body",
    });
    expect(await media(BOB)).toBe(1);
    expect(await media(CARL)).toBe(0);
    // The creator always sees their own files.
    expect(await media(ALICE)).toBe(1);
    // An expired period locks it again.
    await svc(`UPDATE creator_subscriptions SET current_period_end = now() - interval '1 day'`);
    expect((await feed(BOB)).posts.find((p: any) => p.id === paidId).locked).toBe(true);
    expect(await media(BOB)).toBe(0);
    await svc(`UPDATE creator_subscriptions SET current_period_end = now() + interval '20 days'`);
  });

  it("suspension hides subscriber posts; removal hides a post; both are logged", async () => {
    expect(
      await fails(
        as(OWNER, `SELECT public.owner_set_creator_monetization_suspended($1, true)`, [ALICE]),
      ),
    ).toMatch(/reason/i);
    await as(OWNER, `SELECT public.owner_set_creator_monetization_suspended($1, true, 'Review')`, [
      ALICE,
    ]);
    expect((await feed(BOB)).posts.map((p: any) => p.id)).toEqual([publicId]);
    expect(await media(BOB)).toBe(0);
    expect(
      await fails(
        as(ALICE, `SELECT public.creator_submit_offer(800, 'Weekly garden photos and notes')`),
      ),
    ).toMatch(/not approved/i);
    await as(OWNER, `SELECT public.owner_set_creator_monetization_suspended($1, false)`, [ALICE]);
    await as(OWNER, `SELECT public.owner_remove_creator_post($1, true, 'Not safe for work')`, [
      publicId,
    ]);
    expect((await feed(CARL)).posts.map((p: any) => p.id)).toEqual([paidId]);
    const mine = await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`);
    expect(mine.posts.find((p: any) => p.id === publicId)).toMatchObject({
      removed: true,
      removed_reason: "Not safe for work",
    });
    expect(mine.subscribers).toBe(1);
    const log = await svc<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE action LIKE 'creator.%' ORDER BY created_at`,
    );
    expect(log.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "creator.monetization_suspended",
        "creator.monetization_restored",
        "creator.post_removed",
        "creator.offer_approved",
      ]),
    );
  });

  it("a creator can delete only their own post", async () => {
    expect(
      (await as<{ r: boolean }>(BOB, `SELECT public.creator_delete_post($1) AS r`, [paidId]))[0].r,
    ).toBe(false);
    expect(
      (await as<{ r: boolean }>(ALICE, `SELECT public.creator_delete_post($1) AS r`, [paidId]))[0]
        .r,
    ).toBe(true);
    expect((await feed(BOB)).posts).toEqual([]);
  });

  it("only approved creators can upload, and only to their own folder", async () => {
    const can = (who: string, name: string) =>
      as<{ r: boolean }>(who, `SELECT public.creator_media_can_upload($1) AS r`, [name]).then(
        (r) => r[0].r,
      );
    expect(await can(ALICE, `${ALICE}/b.jpg`)).toBe(true);
    expect(await can(ALICE, `${BOB}/b.jpg`)).toBe(false);
    expect(await can(BOB, `${BOB}/b.jpg`)).toBe(false);
  });
});

describe("privacy and owner settings", () => {
  it("browsers can't read the new tables or call the internal functions", async () => {
    for (const t of NEW_TABLES) {
      expect(await fails(as(BOB, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
      expect(await fails(as(null, `SELECT * FROM public.${t}`))).toMatch(/permission denied/i);
    }
    for (const q of [
      `SELECT public.creator_post_unlocked(gen_random_uuid(), '${BOB}')`,
      `SELECT public.has_active_creator_subscription('${BOB}', '${ALICE}')`,
      `SELECT public.creator_is_monetized('${ALICE}')`,
      `SELECT public.creator_subscriptions_on_for('${BOB}')`,
    ]) {
      expect(await fails(as(BOB, q))).toMatch(/permission denied/i);
    }
    expect(await fails(as(null, `SELECT public.my_creator_subscriptions()`))).toMatch(
      /permission denied/i,
    );
    expect(await fails(as(BOB, `SELECT public.owner_creator_subscriptions()`))).toMatch(
      /not authorized/i,
    );
  });

  it("the owner sets fee rates and price limits, logged with before and after", async () => {
    await as(
      OWNER,
      `SELECT public.owner_set_creator_subscription_settings(null, 200, 20000, 500, 30, 290, 30)`,
    );
    const mine = await one(ALICE, `SELECT public.my_creator_subscriptions() AS r`);
    expect(mine.fees).toEqual({
      yooits_percent_bps: 500,
      yooits_fixed_cents: 30,
      stripe_percent_bps: 290,
      stripe_fixed_cents: 30,
    });
    expect(mine.price_min_cents).toBe(200);
    expect(mine.checkout_enabled).toBe(false);
    const owner = await one(OWNER, `SELECT public.owner_creator_subscriptions() AS r`);
    expect(owner.applications).toHaveLength(1);
    expect(owner.creators[0]).toMatchObject({ username: "alice", subscribers: 1 });
    const log = await svc<any>(
      `SELECT details FROM admin_audit_log WHERE action = 'creator_subscriptions.settings' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(log[0].details.after.yooits_percent_bps).toBe(500);
    expect(log[0].details.before.yooits_percent_bps).toBeNull();
  });
});

describe("rollback", () => {
  it("removes only what the migration added and keeps audit rows and earlier tables", async () => {
    const audit = (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n;
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261122200000_creator_subscriptions_foundation.down.sql"),
        "utf8",
      ),
    );
    for (const t of NEW_TABLES) {
      expect(
        (await svc<{ t: string | null }>(`SELECT to_regclass('public.${t}')::text AS t`))[0].t,
      ).toBeNull();
    }
    expect(
      (
        await svc<{ t: string | null }>(
          `SELECT to_regclass('public.creator_milestones')::text AS t`,
        )
      )[0].t,
    ).not.toBeNull();
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log`))[0].n).toBe(
      audit,
    );
  });
});
