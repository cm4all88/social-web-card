/**
 * Dashboard announcements and notifications, on in-memory Postgres with every
 * real migration applied, plus a check that the migration only adds and that
 * its rollback puts the schema back.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

type Feed = {
  enabled: boolean;
  preview?: boolean;
  announcements: { id: string; title: string }[];
  notifications: {
    id: string;
    kind: string;
    title: string;
    read_at: string | null;
    link_path: string | null;
  }[];
  unread: number;
  dm_unread: number;
};

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
const feed = (who: string) =>
  as<{ f: Feed }>(who, `SELECT public.my_dashboard_feed() AS f`).then((r) => r[0].f);

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

const save = (
  who: string,
  a: {
    id?: string | null;
    title: string;
    body?: string;
    link?: string | null;
    label?: string | null;
    audience?: string;
    starts?: string | null;
    ends?: string | null;
  },
) =>
  as<{ id: string }>(
    who,
    `SELECT public.owner_save_announcement($1, $2, $3, $4, $5, $6, $7, $8) AS id`,
    [
      a.id ?? null,
      a.title,
      a.body ?? "Hello there",
      a.link ?? null,
      a.label ?? null,
      a.audience ?? "all",
      a.starts ?? null,
      a.ends ?? null,
    ],
  ).then((r) => r[0].id);

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
  await signUp(BOB, "bob");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
});
afterAll(async () => {
  await db?.close();
});

describe("feature flag", () => {
  it("starts off: people see nothing, the owner sees a preview", async () => {
    expect(await feed(ALICE)).toMatchObject({
      enabled: false,
      announcements: [],
      notifications: [],
      unread: 0,
    });
    const f = await feed(OWNER);
    expect(f.enabled).toBe(true);
    expect(f.preview).toBe(true);
  });

  it("only the owner can switch it, and the switch is logged", async () => {
    expect(
      await fails(
        as(ALICE, `SELECT public.owner_set_feature_flag('dashboard_notifications', true)`),
      ),
    ).toMatch(/Not authorized/);
    // (Production revokes writes outright; the test harness re-grants table
    // rights, so RLS alone must stop the write here.)
    await fails(as(ALICE, `UPDATE feature_flags SET enabled = true`));
    expect((await feed(ALICE)).enabled).toBe(false);
    expect(await fails(as(OWNER, `SELECT public.owner_set_feature_flag('nope', true)`))).toMatch(
      /No feature flag/,
    );
    await as(OWNER, `SELECT public.owner_set_feature_flag('dashboard_notifications', true)`);
    expect((await feed(ALICE)).enabled).toBe(true);
    expect((await feed(OWNER)).preview).toBe(false);
    const log = await svc(
      `SELECT action, actor_user_id FROM admin_audit_log WHERE target_type = 'feature_flag'`,
    );
    expect(log).toEqual([{ action: "feature_flag.enabled", actor_user_id: OWNER }]);
    const [{ e }] = await as<{ e: boolean }>(
      null,
      `SELECT public.feature_enabled('dashboard_notifications') AS e`,
    );
    expect(e).toBe(true);
  });
});

describe("system notifications", () => {
  it("welcomes a new account once", async () => {
    const f = await feed(ALICE);
    expect(f.notifications.map((n) => n.kind)).toEqual(["welcome"]);
    expect(f.notifications[0].link_path).toBe("/dashboard");
    expect(f.unread).toBe(1);
  });

  it("tells a new Founding Member", async () => {
    await svc(
      `INSERT INTO plan_entitlements (user_id, plan, source, ends_at) VALUES ($1, 'plus', 'founding_creator', now() + interval '3 months')`,
      [BOB],
    );
    const f = await feed(BOB);
    expect(f.notifications.map((n) => n.kind).sort()).toEqual(["founding_member", "welcome"]);
  });

  it("tells a signed-in reporter once their report was reviewed", async () => {
    const [{ id }] = await svc<{ id: string }>(
      `INSERT INTO abuse_reports (target_user_id, target_kind, reason, reporter_user_id) VALUES ($1, 'profile', 'spam', $2) RETURNING id`,
      [ALICE, BOB],
    );
    await as(OWNER, `SELECT public.owner_resolve_report($1, 'resolved', NULL)`, [id]);
    await as(OWNER, `SELECT public.owner_resolve_report($1, 'open', NULL)`, [id]);
    await as(OWNER, `SELECT public.owner_resolve_report($1, 'dismissed', NULL)`, [id]);
    const kinds = (await feed(BOB)).notifications.map((n) => n.kind);
    expect(kinds.filter((k) => k === "report_reviewed")).toHaveLength(1);
  });

  it("notify_user is for the server only, dedupes, and keeps links on Yooits", async () => {
    expect(
      await fails(as(ALICE, `SELECT public.notify_user($1, 'reward_unlocked', 'Hi')`, [ALICE])),
    ).toMatch(/permission denied/);
    const call = (link: string | null, key: string | null) =>
      svc<{ id: string | null }>(
        `SELECT public.notify_user($1, 'reward_unlocked', 'New theme', NULL, $2, $3) AS id`,
        [ALICE, link, key],
      ).then((r) => r[0].id);
    expect(await call("/dashboard", "reward:snow")).toBeTruthy();
    expect(await call("/dashboard", "reward:snow")).toBeNull();
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "/\\evil.example",
      "/a b",
    ]) {
      expect(await fails(call(bad, null)), bad).toMatch(/violates check constraint/);
    }
  });

  it("people can only read and mark their own", async () => {
    expect(
      await as(ALICE, `SELECT user_id FROM notifications WHERE user_id <> $1`, [ALICE]),
    ).toEqual([]);
    await fails(as(ALICE, `UPDATE notifications SET read_at = now()`));
    expect((await feed(ALICE)).unread).toBe(2);
    expect(
      await fails(
        as(ALICE, `INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'x', 'x')`, [
          ALICE,
        ]),
      ),
    ).toMatch(/permission denied|row-level security/);
    const bobUnread = (await feed(BOB)).unread;
    const [{ n }] = await as<{ n: number }>(
      ALICE,
      `SELECT public.mark_notifications_read(NULL) AS n`,
    );
    expect(n).toBe(2);
    expect((await feed(ALICE)).unread).toBe(0);
    expect((await feed(BOB)).unread).toBe(bobUnread);
    const bobFirst = (await feed(BOB)).notifications[0].id;
    const [{ m }] = await as<{ m: number }>(
      ALICE,
      `SELECT public.mark_notifications_read($1::uuid[]) AS m`,
      [[bobFirst]],
    );
    expect(m).toBe(0);
    const [{ k }] = await as<{ k: number }>(
      BOB,
      `SELECT public.mark_notifications_read($1::uuid[]) AS k`,
      [[bobFirst]],
    );
    expect(k).toBe(1);
  });

  it("anonymous visitors can't read the feed", async () => {
    expect(await fails(as(null, `SELECT public.my_dashboard_feed()`))).toMatch(/permission denied/);
  });
});

describe("announcements", () => {
  it("only the owner can write or list them", async () => {
    expect(await fails(save(ALICE, { title: "x" }))).toMatch(/Not authorized/);
    expect(await fails(as(ALICE, `SELECT public.owner_list_announcements()`))).toMatch(
      /Not authorized/,
    );
    expect(await as(ALICE, `SELECT * FROM announcements`).catch(() => [])).toEqual([]);
    expect(await fails(save(OWNER, { title: " " }))).toMatch(/needs a title/);
    expect(await fails(save(OWNER, { title: "x", link: "javascript:alert(1)" }))).toMatch(
      /check constraint/,
    );
    expect(await fails(save(OWNER, { title: "x", link: "https://a@evil.example" }))).toMatch(
      /check constraint/,
    );
  });

  it("reach the right audience, in their window, until dismissed or archived", async () => {
    const all = await save(OWNER, {
      title: "Everyone",
      link: "/dashboard/wishlists",
      label: "Try it",
    });
    const founding = await save(OWNER, { title: "Founders only", audience: "founding" });
    const plus = await save(OWNER, { title: "Plus only", audience: "plus" });
    const later = await save(OWNER, {
      title: "Later",
      starts: new Date(Date.now() + 864e5).toISOString(),
    });
    const titles = async (who: string) =>
      (await feed(who)).announcements.map((a) => a.title).sort();
    expect(await titles(ALICE)).toEqual(["Everyone"]);
    expect(await titles(BOB)).toEqual(["Everyone", "Founders only", "Plus only"]);

    await as(ALICE, `SELECT public.dismiss_announcement($1)`, [all]);
    expect(await titles(ALICE)).toEqual([]);
    expect(await titles(BOB)).toContain("Everyone");

    await as(OWNER, `SELECT public.owner_archive_announcement($1, true)`, [founding]);
    expect(await titles(BOB)).toEqual(["Everyone", "Plus only"]);
    await as(OWNER, `SELECT public.owner_archive_announcement($1, false)`, [founding]);
    expect(await titles(BOB)).toContain("Founders only");

    await save(OWNER, {
      id: plus,
      title: "Plus, edited",
      audience: "plus",
      ends: new Date(Date.now() - 1000).toISOString(),
      starts: new Date(Date.now() - 864e5).toISOString(),
    });
    expect(await titles(BOB)).not.toContain("Plus, edited");

    const [{ l }] = await as<{
      l: { announcements: { id: string; state: string; dismissals: number }[] };
    }>(OWNER, `SELECT public.owner_list_announcements() AS l`);
    const state = Object.fromEntries(l.announcements.map((a) => [a.id, a.state]));
    expect(state).toEqual({
      [all]: "live",
      [founding]: "live",
      [plus]: "ended",
      [later]: "scheduled",
    });
    expect(l.announcements.find((a) => a.id === all)?.dismissals).toBe(1);
    const log = await svc<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE target_type = 'announcement' ORDER BY created_at, action`,
    );
    expect(log.map((r) => r.action).sort()).toEqual(
      [
        "announcement.archived",
        "announcement.created",
        "announcement.created",
        "announcement.created",
        "announcement.created",
        "announcement.edited",
        "announcement.restored",
      ].sort(),
    );
  });

  it("shows unread direct messages when messaging provides a count", async () => {
    // Messaging starts switched off, so its count is 0.
    expect((await feed(ALICE)).dm_unread).toBe(0);
    const [{ def }] = await svc<{ def: string }>(
      `SELECT pg_get_functiondef('public.dm_unread_count()'::regprocedure) AS def`,
    );
    await db.exec(
      `CREATE OR REPLACE FUNCTION public.dm_unread_count() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 4 $$`,
    );
    try {
      expect((await feed(ALICE)).dm_unread).toBe(4);
    } finally {
      await db.exec(def);
    }
  });
});

describe("account deletion", () => {
  it("removes a person's notifications and dismissals with their sign-in", async () => {
    await svc(`DELETE FROM profiles WHERE user_id = $1`, [ALICE]);
    await svc(`DELETE FROM auth.users WHERE id = $1`, [ALICE]);
    const [r] = await svc<{ n: number; d: number }>(
      `SELECT (SELECT count(*)::int FROM notifications WHERE user_id = $1) AS n,
              (SELECT count(*)::int FROM announcement_dismissals WHERE user_id = $1) AS d`,
      [ALICE],
    );
    expect(r).toEqual({ n: 0, d: 0 });
  });
});

describe("migration and rollback", () => {
  const one = async (d: PGlite, q: string) => (await d.query<{ v: string }>(q)).rows[0].v;
  const shape = async (d: PGlite) => ({
    fns: await one(
      d,
      `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname, p.oid) AS v
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
    ),
    cols: await one(
      d,
      `SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, ordinal_position) AS v
         FROM information_schema.columns WHERE table_schema = 'public'`,
    ),
    policies: await one(
      d,
      `SELECT coalesce(string_agg(tablename || '.' || policyname, ',' ORDER BY tablename, policyname), '') AS v FROM pg_policies WHERE schemaname = 'public'`,
    ),
    triggers: await one(
      d,
      `SELECT coalesce(string_agg(tgrelid::regclass::text || '.' || tgname, ',' ORDER BY 1), '') AS v FROM pg_trigger WHERE NOT tgisinternal`,
    ),
  });

  it("keeps every existing row and rolls back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("CREATE TABLE public.announcements"));
    expect(idx).toBeGreaterThan(-1);
    const d = new PGlite();
    await d.exec(SUPABASE_STUBS);
    await d.exec(
      `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`,
    );
    for (const sql of all.slice(0, idx)) await d.exec(sql);
    await d.exec(SUPABASE_GRANTS);
    await d.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@example.test', '{"username":"alice"}')`,
      [ALICE],
    );
    const count = (t: string) => one(d, `SELECT count(*)::text AS v FROM public.${t}`);
    const before = await shape(d);
    const profiles = await count("profiles");

    await d.exec(all[idx]);
    await d.exec(SUPABASE_GRANTS);
    expect(await count("profiles")).toBe(profiles);
    // Existing accounts get no back-dated welcome.
    expect(await count("notifications")).toBe("0");

    const down = readFileSync(
      join(__dirname, "..", "rollbacks", "20261122150000_announcements_notifications.down.sql"),
      "utf8",
    );
    await d.exec(down);
    expect(await shape(d)).toEqual(before);
    expect(await count("profiles")).toBe(profiles);
    await d.close();
  });
});
