/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Wishlist gift money (switched off) on in-memory Postgres with every real
 * migration applied: it can't be switched on without Stripe's written
 * approval and a fee, and once on, money only reaches an adult, approved list
 * owner with a connected account. Plus privacy of the tables and rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const PARENT = "00000000-0000-4000-8000-0000000000a1";
const GRANDMA = "00000000-0000-4000-8000-0000000000b1";

let db: PGlite;
let itemId = "";
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
const gate = () =>
  svc<{ g: any }>(`SELECT public.wishlist_gift_checkout_gate($1, $2) AS g`, [GRANDMA, itemId]).then(
    (r) => r[0].g,
  );
const setSettings = (args: string) =>
  as(ADMIN, `SELECT public.owner_set_wishlist_gift_settings(${args})`);

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
  await db.exec(
    `REVOKE ALL ON public.wishlist_gift_settings, public.wishlist_gift_recipients, public.wishlist_gifts FROM anon, authenticated`,
  );
  await signUp(ADMIN, "boss");
  await signUp(PARENT, "mom");
  await signUp(GRANDMA, "grandma");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  const [w] = await as<{ id: string }>(
    PARENT,
    `INSERT INTO wishlists (user_id, slug, title, visibility, recipient_name, accepts_gift_money)
     VALUES ($1, 'mias-christmas', 'Mia''s list', 'public', 'Mia', true) RETURNING id`,
    [PARENT],
  );
  const [it] = await as<{ id: string }>(
    PARENT,
    `INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Bike') RETURNING id`,
    [w.id, PARENT],
  );
  itemId = it.id;
}, 60_000);

afterAll(() => db?.close());

describe("switched off", () => {
  it("starts off and the gate refuses", async () => {
    expect(await gate()).toEqual({ ok: false, reason: "off" });
  });

  it("can't be switched on without Stripe's written approval", async () => {
    expect(await fails(setSettings("true"))).toMatch(/wishlist_gift_needs_stripe_approval/);
    expect(await fails(setSettings("NULL, true"))).toBeTruthy();
  });

  it("checkout can't go on without a fee, even with approval", async () => {
    expect(await fails(setSettings("true, true, 'Stripe email ref 123'"))).toMatch(
      /wishlist_gift_checkout_needs_rates/,
    );
  });

  it("only admins can change it, and changes are audited", async () => {
    expect(
      await fails(as(GRANDMA, `SELECT public.owner_set_wishlist_gift_settings(false)`)),
    ).toBeTruthy();
    await setSettings("false");
    const [{ n }] = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'wishlist_gifts.settings'`,
    );
    expect(n).toBe(1);
  });

  it("nobody reads the tables directly and nobody but the server runs the gate", async () => {
    for (const t of ["wishlist_gift_settings", "wishlist_gift_recipients", "wishlist_gifts"]) {
      expect(await fails(as(GRANDMA, `SELECT * FROM ${t}`))).toBeTruthy();
      expect(await fails(as(PARENT, `SELECT * FROM ${t}`))).toBeTruthy();
    }
    expect(
      await fails(
        as(GRANDMA, `SELECT public.wishlist_gift_checkout_gate($1, $2)`, [GRANDMA, itemId]),
      ),
    ).toBeTruthy();
  });
});

describe("once Stripe agrees (simulated)", () => {
  it("still refuses until the list owner is an approved adult with a connected account", async () => {
    await setSettings("true, true, 'Stripe email ref 123', 0, 50, 290, 30");
    expect(await gate()).toEqual({ ok: false, reason: "unavailable" });

    // Approved but no 18+ statement: refused. Never a minor's account.
    await as(ADMIN, `SELECT public.owner_set_wishlist_gift_recipient($1, true)`, [PARENT]);
    expect((await gate()).ok).toBe(false);

    await as(ADMIN, `SELECT public.owner_set_wishlist_gift_recipient($1, true, true)`, [PARENT]);
    expect((await gate()).ok).toBe(false); // no Stripe account yet

    await svc(
      `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled)
       VALUES ($1, 'acct_test', 'connected', true)`,
      [PARENT],
    );
    const g = await gate();
    expect(g).toMatchObject({ ok: true, recipient_user_id: PARENT, item_name: "Bike" });
    expect(g.account).toEqual({ stripe_account_id: "acct_test", livemode: false });
  });

  it("refuses the owner's own list, lists that don't accept it, and suspended owners", async () => {
    expect(
      (
        await svc<{ g: any }>(`SELECT public.wishlist_gift_checkout_gate($1, $2) AS g`, [
          PARENT,
          itemId,
        ])
      )[0].g,
    ).toEqual({ ok: false, reason: "self" });
    expect(
      (
        await svc<{ g: any }>(`SELECT public.wishlist_gift_checkout_gate(NULL, $1) AS g`, [itemId])
      )[0].g,
    ).toEqual({ ok: false, reason: "sign_in" });

    await svc(`UPDATE wishlists SET accepts_gift_money = false`);
    expect((await gate()).ok).toBe(false);
    await svc(`UPDATE wishlists SET accepts_gift_money = true`);

    await as(
      ADMIN,
      `SELECT public.owner_set_wishlist_gift_recipient($1, true, NULL, true, 'test')`,
      [PARENT],
    );
    expect((await gate()).ok).toBe(false);
    await as(ADMIN, `SELECT public.owner_set_wishlist_gift_recipient($1, true, NULL, false)`, [
      PARENT,
    ]);
    expect((await gate()).ok).toBe(true);
  });

  it("switching back off stops it at once", async () => {
    await setSettings("false, false");
    expect(await gate()).toEqual({ ok: false, reason: "off" });
  });
});

describe("rollback", () => {
  it("removes everything the migration added", async () => {
    await db.exec(
      readFileSync(
        join(__dirname, "..", "rollbacks", "20261122234000_wishlist_gift_money.down.sql"),
        "utf8",
      ),
    );
    const left = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE '%wishlist_gift%'`,
    );
    expect(left[0].n).toBe(0);
    const cols = await svc(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'wishlists' AND column_name = 'accepts_gift_money'`,
    );
    expect(cols).toEqual([]);
  });
});
