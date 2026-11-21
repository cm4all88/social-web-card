/**
 * Founding beta under real concurrency: many people redeeming at the same
 * moment can't take more seats than exist, and one code can't be used twice.
 * Runs only when TEST_DATABASE_URL points at a disposable local Postgres
 * superuser (see concurrency.pg.test.ts). Never point this at Supabase.
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
const DB_NAME = `yooits_beta_${process.pid}_${Date.now()}`;
const OWNER = "00000000-0000-4000-8000-0000000000aa";
const user = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

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

const asUser = (uid: string, sql: string) =>
  `BEGIN; SET LOCAL request.jwt.claim.sub = '${uid}'; SET LOCAL ROLE authenticated; ${sql}; SELECT pg_sleep(0.2); COMMIT;`;

describe.skipIf(!ADMIN_URL)("founding beta against a real Postgres", () => {
  beforeAll(async () => {
    await psql(ADMIN_URL!, `CREATE DATABASE ${DB_NAME}`);
    const dir = mkdtempSync(join(tmpdir(), "yooits-beta-"));
    const file = join(dir, "setup.sql");
    writeFileSync(
      file,
      [
        SUPABASE_STUBS,
        `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
        ...migrationSql(),
        SUPABASE_GRANTS,
        `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${OWNER}', 'o@x.test', '{"username":"boss"}')`,
        `INSERT INTO user_roles (user_id, role) VALUES ('${OWNER}', 'admin')`,
        `UPDATE beta_programs SET open = true`,
        ...Array.from(
          { length: 12 },
          (_, i) =>
            `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${user(i + 1)}', 'u${i}@x.test', '{"username":"user${i}"}')`,
        ),
      ].join("\n;\n"),
    );
    await run("psql", [dbUrl(DB_NAME), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file]);
  }, 60_000);

  afterAll(async () => {
    if (ADMIN_URL) await psql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  });

  it("one code redeemed by six people at once goes to exactly one of them", async () => {
    const [code] = await psql(
      dbUrl(DB_NAME),
      asUser(OWNER, `SELECT code FROM public.owner_beta_create_invites(1)`).replace(
        "SELECT pg_sleep(0.2);",
        "",
      ),
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        psql(dbUrl(DB_NAME), asUser(user(i + 1), `SELECT public.redeem_beta_invite('${code}')`)),
      ),
    );
    const outcomes = results.map((r) => r[0]).sort();
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "used")).toHaveLength(5);
    const [n] = await psql(dbUrl(DB_NAME), `SELECT count(*) FROM plan_entitlements`);
    expect(Number(n)).toBe(1);
  }, 30_000);

  it("six people racing for the last two seats: two get in", async () => {
    // 1 grant exists; open six codes, then shrink the cap to 3 so only 2 seats remain.
    const codes = await psql(
      dbUrl(DB_NAME),
      asUser(OWNER, `SELECT code FROM public.owner_beta_create_invites(6)`).replace(
        "SELECT pg_sleep(0.2);",
        "",
      ),
    );
    await psql(dbUrl(DB_NAME), `UPDATE beta_programs SET max_seats = 3`);
    const results = await Promise.all(
      codes.map((c, i) =>
        psql(dbUrl(DB_NAME), asUser(user(i + 7), `SELECT public.redeem_beta_invite('${c}')`)),
      ),
    );
    const outcomes = results.map((r) => r[0]);
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(2);
    expect(outcomes.filter((o) => o === "full")).toHaveLength(4);
    const [n] = await psql(
      dbUrl(DB_NAME),
      `SELECT count(*) FROM plan_entitlements WHERE revoked_at IS NULL`,
    );
    expect(Number(n)).toBe(3);
  }, 30_000);
});
