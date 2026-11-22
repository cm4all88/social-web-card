/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Creator subscriptions sandbox on in-memory Postgres with every real
 * migration applied. While subscriptions are off, a creator on the sandbox
 * list can apply and be sold only through a Stripe test payment account;
 * nobody else sees anything new. And the rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const TESTER = "00000000-0000-4000-8000-0000000000b1"; // sandbox creator
const OTHER = "00000000-0000-4000-8000-0000000000b2"; // creator not on the list
const SUB = "00000000-0000-4000-8000-0000000000b3"; // subscriber

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
const one = async (q: string, p: unknown[] = []) => (await svc<{ r: any }>(q, p))[0].r;
const offer = (u: string) => one(`SELECT public.creator_subscription_public_offer($1) AS r`, [u]);
const gate = (u: string) =>
  one(`SELECT public.creator_subscription_checkout_gate($1, $2) AS r`, [SUB, u]);

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

async function creator(id: string, username: string, livemode: boolean) {
  await signUp(id, username);
  await svc(`INSERT INTO creator_monetization (user_id) VALUES ($1)`, [id]);
  await svc(
    `INSERT INTO creator_subscription_offers (user_id, version, price_cents, description, status)
     VALUES ($1, 1, 500, 'Test offer for the sandbox', 'approved')`,
    [id],
  );
  await svc(
    `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled, livemode)
     VALUES ($1, $2, 'connected', true, $3)`,
    [id, `acct_${username}`, livemode],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await creator(TESTER, "tester", false);
  await creator(OTHER, "other", false);
  await signUp(SUB, "subby");
  // The owner's fees are set, but subscriptions and checkout stay off.
  await svc(
    `UPDATE creator_subscription_settings SET enabled = false, checkout_enabled = false,
       yooits_percent_bps = 0, yooits_fixed_cents = 50, stripe_percent_bps = 290, stripe_fixed_cents = 30`,
  );
}, 60_000);

afterAll(() => db?.close());

describe("sandbox creators", () => {
  it("everything stays off until a creator is on the list", async () => {
    for (const u of ["tester", "other"]) {
      expect((await offer(u)).reason).toBe("off");
      expect((await gate(u)).reason).toBe("off");
    }
    expect(await one(`SELECT public.creator_subscriptions_on_for($1) AS r`, [TESTER])).toBe(false);
    expect(await one(`SELECT public.creator_can_apply($1) AS r`, [TESTER])).toBe(false);
  });

  it("a listed creator with a test payment account can be sold; others still can't", async () => {
    await svc(`INSERT INTO creator_subscription_sandbox_creators (user_id) VALUES ($1)`, [TESTER]);
    expect(await offer("tester")).toMatchObject({ ok: true, price_cents: 500 });
    expect(await gate("tester")).toMatchObject({
      ok: true,
      account: { stripe_account_id: "acct_tester", livemode: false },
    });
    expect((await offer("other")).reason).toBe("off");
    expect((await gate("other")).reason).toBe("off");
    expect(await one(`SELECT public.creator_subscriptions_on_for($1) AS r`, [TESTER])).toBe(true);
    expect(await one(`SELECT public.creator_can_apply($1) AS r`, [TESTER])).toBe(true);
    expect(await one(`SELECT public.creator_subscriptions_on_for($1) AS r`, [SUB])).toBe(false);
  });

  it("never through a live payment account", async () => {
    await svc(`UPDATE creator_payment_accounts SET livemode = true WHERE user_id = $1`, [TESTER]);
    expect((await offer("tester")).reason).toBe("off");
    expect((await gate("tester")).reason).toBe("off");
    await svc(`UPDATE creator_payment_accounts SET livemode = false WHERE user_id = $1`, [TESTER]);
  });

  it("still needs the fees and the usual checks", async () => {
    await svc(`UPDATE creator_subscription_settings SET yooits_fixed_cents = NULL`);
    expect((await gate("tester")).reason).toBe("off");
    await svc(`UPDATE creator_subscription_settings SET yooits_fixed_cents = 50`);
    expect(
      (await one(`SELECT public.creator_subscription_checkout_gate(NULL, 'tester') AS r`)).reason,
    ).toBe("sign_in");
    await svc(`UPDATE creator_monetization SET suspended_at = now() WHERE user_id = $1`, [TESTER]);
    expect((await gate("tester")).reason).toBe("unavailable");
    await svc(`UPDATE creator_monetization SET suspended_at = NULL WHERE user_id = $1`, [TESTER]);
  });

  it("the list and its helpers are server-only", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role};`);
      try {
        // Row security with no policies: the list reads as empty, or is refused.
        const rows = await db
          .query(`SELECT * FROM creator_subscription_sandbox_creators`)
          .then((r) => r.rows)
          .catch(() => []);
        expect(rows).toEqual([]);
        await expect(db.query(`SELECT public.creator_is_sandbox(NULL)`)).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await db.exec("RESET ROLE;");
      }
    }
  });
});

describe("rollback", () => {
  it("removes the list and turns the sandbox creator off again", async () => {
    await db.exec(
      readFileSync(
        join(__dirname, "../rollbacks/20261122236000_creator_subscription_sandbox.down.sql"),
        "utf8",
      ),
    );
    expect(
      (await svc<{ t: string | null }>(
        `SELECT to_regclass('public.creator_subscription_sandbox_creators')::text AS t`,
      ))[0].t,
    ).toBeNull();
    expect((await offer("tester")).reason).toBe("off");
    expect((await gate("tester")).reason).toBe("off");
    expect(await one(`SELECT public.creator_can_apply($1) AS r`, [TESTER])).toBe(false);
  });
});
