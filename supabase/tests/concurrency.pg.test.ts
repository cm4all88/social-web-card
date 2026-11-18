/**
 * Real concurrency checks for webhook event claiming and checkout rate limits.
 *
 * In-memory PGlite runs one statement at a time, so it can't show what happens
 * when two requests hit the database at the same moment. These tests need a
 * real Postgres and run only when TEST_DATABASE_URL is set (a superuser URL on
 * a disposable local server, e.g. postgres://postgres:pw@127.0.0.1:5432/postgres).
 * They create a throwaway database, apply every migration, then fire many
 * separate `psql` sessions in parallel. Never point this at Supabase.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const run = promisify(execFile);
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB_NAME = `yooits_concurrency_${process.pid}_${Date.now()}`;
const CREATOR = "00000000-0000-4000-8000-0000000000c1";

function dbUrl(name: string) {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function psql(url: string, sql: string): Promise<string[]> {
  const { stdout } = await run("psql", [
    url,
    "-X",
    "-q",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  return stdout.split("\n").filter((l) => l.length > 0);
}

async function psqlFile(url: string, sql: string) {
  const dir = mkdtempSync(join(tmpdir(), "yooits-sql-"));
  const file = join(dir, "setup.sql");
  writeFileSync(file, sql);
  await run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file]);
}

/** Start `n` separate database sessions at once, each running `sql`. */
function parallel(n: number, sql: (i: number) => string) {
  return Promise.all(Array.from({ length: n }, (_, i) => psql(dbUrl(DB_NAME), sql(i))));
}

describe.skipIf(!ADMIN_URL)("concurrent requests against a real Postgres", () => {
  beforeAll(async () => {
    await psql(ADMIN_URL!, `CREATE DATABASE ${DB_NAME}`);
    await psqlFile(
      dbUrl(DB_NAME),
      [SUPABASE_STUBS, ...migrationSql(), SUPABASE_GRANTS].join("\n;\n"),
    );
  }, 60_000);

  afterAll(async () => {
    if (ADMIN_URL) await psql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  });

  it("only one of many simultaneous deliveries of an event gets to process it", async () => {
    // Each session holds its transaction open briefly after claiming, so the
    // others are guaranteed to arrive while the first claim is uncommitted.
    const results = await parallel(
      8,
      () => `BEGIN;
        SELECT public.claim_stripe_event('evt_race', 'checkout.session.completed', 'acct_1', false);
        SELECT pg_sleep(0.3);
        COMMIT;`,
    );
    const outcomes = results.map((lines) => lines[0]).sort();
    expect(outcomes.filter((o) => o === "claimed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "in_progress")).toHaveLength(7);

    await psql(
      dbUrl(DB_NAME),
      `UPDATE stripe_events SET processed_at = now() WHERE id = 'evt_race'`,
    );
    const again = await parallel(
      4,
      () =>
        `SELECT public.claim_stripe_event('evt_race', 'checkout.session.completed', 'acct_1', false);`,
    );
    expect(again.map((l) => l[0])).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
  }, 30_000);

  it("simultaneous checkouts from one IP can't get past the per-IP limit", async () => {
    const results = await parallel(
      25,
      () => `BEGIN;
        SELECT public.record_checkout_attempt('same-ip', '${CREATOR}'::uuid, 10, 600, 1000, 3600);
        SELECT pg_sleep(0.05);
        COMMIT;`,
    );
    const allowed = results.filter((lines) => lines[0] === "t").length;
    expect(allowed).toBe(10);
    const [count] = await psql(
      dbUrl(DB_NAME),
      `SELECT count(*) FROM checkout_attempts WHERE ip_hash = 'same-ip'`,
    );
    expect(Number(count)).toBe(10);
  }, 30_000);

  it("simultaneous checkouts from many IPs can't get past the per-creator limit", async () => {
    const other = "00000000-0000-4000-8000-0000000000c2";
    const results = await parallel(
      20,
      (i) => `BEGIN;
        SELECT public.record_checkout_attempt('ip-${i}', '${other}'::uuid, 10, 600, 6, 3600);
        SELECT pg_sleep(0.05);
        COMMIT;`,
    );
    expect(results.filter((lines) => lines[0] === "t")).toHaveLength(6);
  }, 30_000);
});
