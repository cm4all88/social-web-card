/**
 * stripe_setup_items on in-memory Postgres with every real migration: only the
 * server can read it, and the rollback removes it.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
});
afterAll(() => db?.close());

describe("stripe_setup_items", () => {
  it("stores one row per item and mode", async () => {
    await db.query(
      `INSERT INTO stripe_setup_items (item, livemode, stripe_account_id, object_id, url, secret_ciphertext, secret_iv)
       VALUES ('connect_webhook', true, 'acct_1', 'we_1', 'https://yooits.me/api/stripe/webhook', 'c', 'i')`,
    );
    await expect(
      db.query(
        `INSERT INTO stripe_setup_items (item, livemode, stripe_account_id, object_id) VALUES ('connect_webhook', true, 'acct_1', 'we_2')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO stripe_setup_items (item, livemode, stripe_account_id, object_id) VALUES ('other', true, 'a', 'b')`,
      ),
    ).rejects.toThrow();
  });

  it("can't be read by signed-in or anonymous people", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      const r = await db
        .query(`SELECT * FROM stripe_setup_items`)
        .then((x) => x.rows.length)
        .catch(() => "refused");
      await db.exec(`RESET ROLE`);
      expect(r === 0 || r === "refused").toBe(true);
    }
  });

  it("rolls back", async () => {
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261123000000_stripe_setup_items.down.sql"),
        "utf8",
      ),
    );
    const r = await db.query(`SELECT to_regclass('public.stripe_setup_items') AS t`);
    expect((r.rows[0] as { t: string | null }).t).toBeNull();
  });
});
