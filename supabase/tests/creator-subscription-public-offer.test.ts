/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Creator subscriptions step 4 on in-memory Postgres with every real
 * migration applied: what a profile may show about a creator's subscription.
 * Off until the owner turns on subscriptions, checkout and the fees; nothing
 * for free accounts; only the server can call it; and the rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const ALICE = "00000000-0000-4000-8000-0000000000a1"; // creator
const FREE = "00000000-0000-4000-8000-0000000000f1"; // ordinary free account

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
const offer = async (username: string) =>
  (await svc<{ r: any }>(`SELECT public.creator_subscription_public_offer($1) AS r`, [username]))[0]
    .r;

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
  await signUp(ALICE, "alice");
  await signUp(FREE, "freddie");
  await svc(`INSERT INTO creator_monetization (user_id) VALUES ($1)`, [ALICE]);
  await svc(
    `INSERT INTO creator_subscription_offers (user_id, version, price_cents, description, status)
     VALUES ($1, 1, 500, 'Weekly garden photos and notes', 'approved')`,
    [ALICE],
  );
  await svc(
    `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled)
     VALUES ($1, 'acct_alice', 'connected', true)`,
    [ALICE],
  );
}, 60_000);

afterAll(() => db?.close());

describe("public subscription offer", () => {
  it("is off until subscriptions, checkout and the fees are all set", async () => {
    expect(await offer("alice")).toEqual({ ok: false, reason: "off" });
    await svc(
      `UPDATE creator_subscription_settings SET enabled = true, checkout_enabled = false,
         yooits_percent_bps = 0, yooits_fixed_cents = 50, stripe_percent_bps = 290, stripe_fixed_cents = 30`,
    );
    expect((await offer("alice")).reason).toBe("off");
    await svc(`UPDATE creator_subscription_settings SET checkout_enabled = true`);
    expect(await offer("alice")).toMatchObject({
      ok: true,
      username: "alice",
      price_cents: 500,
      currency: "usd",
      description: "Weekly garden photos and notes",
      account: { stripe_account_id: "acct_alice", charges_enabled: true, livemode: false },
    });
  });

  it("offers nothing for a free account or an unknown name", async () => {
    expect((await offer("freddie")).reason).toBe("unavailable");
    expect((await offer("nobody")).reason).toBe("unavailable");
  });

  it("offers nothing once the creator is suspended or has no payment account", async () => {
    await svc(`UPDATE creator_monetization SET suspended_at = now() WHERE user_id = $1`, [ALICE]);
    expect((await offer("alice")).reason).toBe("unavailable");
    await svc(`UPDATE creator_monetization SET suspended_at = NULL WHERE user_id = $1`, [ALICE]);
    await svc(`DELETE FROM creator_payment_accounts WHERE user_id = $1`, [ALICE]);
    expect((await offer("alice")).reason).toBe("unavailable");
    await svc(
      `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled)
       VALUES ($1, 'acct_alice', 'connected', true)`,
      [ALICE],
    );
    expect((await offer("alice")).ok).toBe(true);
  });

  it("can only be called by the server", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role};`);
      try {
        await expect(
          db.query(`SELECT public.creator_subscription_public_offer('alice')`),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("RESET ROLE;");
      }
    }
  });
});

describe("rollback", () => {
  it("removes the function", async () => {
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261122235000_creator_subscription_public_offer.down.sql"),
        "utf8",
      ),
    );
    expect(
      (
        await svc<{ f: string | null }>(
          `SELECT to_regprocedure('public.creator_subscription_public_offer(text)')::text AS f`,
        )
      )[0].f,
    ).toBeNull();
  });
});
