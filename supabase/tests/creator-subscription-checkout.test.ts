/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Creator subscriptions step 3 on in-memory Postgres with every real
 * migration applied: the checkout gate the server calls before it creates a
 * Stripe checkout. Off until the owner turns on subscriptions and checkout
 * and sets the fees; refuses self, suspended, unapproved or already
 * subscribed; only the server can call it; and the rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1"; // creator
const BOB = "00000000-0000-4000-8000-0000000000b1"; // subscriber
const CARL = "00000000-0000-4000-8000-0000000000c1"; // another subscriber

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
const gate = async (who: string | null, username = "alice") =>
  (
    await svc<{ r: any }>(`SELECT public.creator_subscription_checkout_gate($1, $2) AS r`, [
      who,
      username,
    ])
  )[0].r;
const settings = (enabled: boolean, checkout: boolean, fees: boolean) =>
  svc(
    `UPDATE creator_subscription_settings SET enabled = $1, checkout_enabled = $2,
       yooits_percent_bps = $3, yooits_fixed_cents = $4, stripe_percent_bps = $5, stripe_fixed_cents = $6`,
    fees ? [enabled, checkout, 0, 50, 290, 30] : [enabled, checkout, null, null, null, null],
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
  await db.exec(`REVOKE ALL ON public.creator_subscriptions FROM anon, authenticated`);
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await signUp(CARL, "carl");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
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

describe("checkout gate", () => {
  it("is off by default, even for the owner", async () => {
    expect(await gate(BOB)).toEqual({ ok: false, reason: "off" });
    expect(await gate(OWNER)).toEqual({ ok: false, reason: "off" });
  });

  it("stays off until subscriptions, checkout and the fees are all set", async () => {
    await settings(true, false, true);
    expect((await gate(BOB)).reason).toBe("off");
    await settings(true, true, false);
    expect((await gate(BOB)).reason).toBe("off");
    await settings(false, true, true);
    expect((await gate(BOB)).reason).toBe("off");
    await settings(true, true, true);
    expect((await gate(BOB)).ok).toBe(true);
  });

  it("gives the server the approved price, the owner's rates and the creator's account", async () => {
    expect(await gate(BOB, " Alice ")).toMatchObject({
      ok: true,
      creator_user_id: ALICE,
      username: "alice",
      price_cents: 500,
      currency: "usd",
      rates: {
        yooits_percent_bps: 0,
        yooits_fixed_cents: 50,
        stripe_percent_bps: 290,
        stripe_fixed_cents: 30,
      },
      account: {
        stripe_account_id: "acct_alice",
        status: "connected",
        charges_enabled: true,
        livemode: false,
      },
    });
  });

  it("refuses signed-out people, yourself and unknown creators", async () => {
    expect((await gate(null)).reason).toBe("sign_in");
    expect((await gate(ALICE)).reason).toBe("self");
    expect((await gate(BOB, "nobody")).reason).toBe("unavailable");
    expect((await gate(BOB, "carl")).reason).toBe("unavailable");
  });

  it("refuses a suspended creator, and a creator with no approved offer", async () => {
    await svc(`UPDATE creator_monetization SET suspended_at = now() WHERE user_id = $1`, [ALICE]);
    expect((await gate(BOB)).reason).toBe("unavailable");
    await svc(`UPDATE creator_monetization SET suspended_at = NULL WHERE user_id = $1`, [ALICE]);
    await svc(`UPDATE creator_subscription_offers SET status = 'retired' WHERE user_id = $1`, [
      ALICE,
    ]);
    expect((await gate(BOB)).reason).toBe("unavailable");
    await svc(`UPDATE creator_subscription_offers SET status = 'approved' WHERE user_id = $1`, [
      ALICE,
    ]);
    expect((await gate(BOB)).ok).toBe(true);
  });

  it("refuses an approved price outside the owner's current limits", async () => {
    await svc(`UPDATE creator_subscription_settings SET price_min_cents = 1000`);
    expect((await gate(BOB)).reason).toBe("unavailable");
    await svc(`UPDATE creator_subscription_settings SET price_min_cents = 100`);
  });

  it("refuses someone already subscribed, until the subscription ends", async () => {
    await svc(
      `INSERT INTO creator_subscriptions (subscriber_user_id, creator_user_id, status, price_cents, fee_cents, current_period_end)
       VALUES ($1, $2, 'active', 500, 97, now() + interval '20 days')`,
      [CARL, ALICE],
    );
    expect((await gate(CARL)).reason).toBe("already_subscribed");
    await svc(
      `UPDATE creator_subscriptions SET status = 'canceled' WHERE subscriber_user_id = $1`,
      [CARL],
    );
    expect((await gate(CARL)).ok).toBe(true);
  });

  it("limits checkout attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await svc(
        `INSERT INTO creator_subscriptions (subscriber_user_id, creator_user_id, status, price_cents, fee_cents)
         VALUES ($1, $2, 'incomplete', 500, 97)`,
        [BOB, ALICE],
      );
    }
    expect((await gate(BOB)).reason).toBe("rate_limited");
  });

  it("can only be called by the server", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET request.jwt.claim.sub = '${BOB}'; SET ROLE ${role};`);
      try {
        await expect(
          db.query(`SELECT public.creator_subscription_checkout_gate($1, 'alice')`, [BOB]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
      }
    }
  });

  it("keeps the subscriptions table closed to browsers", async () => {
    await db.exec(`SET request.jwt.claim.sub = '${BOB}'; SET ROLE authenticated;`);
    try {
      await expect(db.query(`SELECT * FROM public.creator_subscriptions`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
    }
  });
});

describe("rollback", () => {
  it("removes the gate and keeps the subscription records", async () => {
    const before = (
      await svc<{ n: number }>(`SELECT count(*)::int AS n FROM creator_subscriptions`)
    )[0].n;
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261122230000_creator_subscription_checkout.down.sql"),
        "utf8",
      ),
    );
    expect(
      (
        await svc<{ f: string | null }>(
          `SELECT to_regprocedure('public.creator_subscription_checkout_gate(uuid, text)')::text AS f`,
        )
      )[0].f,
    ).toBeNull();
    expect(
      (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM creator_subscriptions`))[0].n,
    ).toBe(before);
  });
});
