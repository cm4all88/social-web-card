/**
 * Applies every migration to an in-memory Postgres (PGlite) with minimal
 * Supabase stand-ins (auth.uid(), anon/authenticated roles, storage schema),
 * then checks the row-level security and constraints the tipping and wishlist
 * features rely on. No network, no real Supabase project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "..", "migrations");
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b0";

const SUPABASE_STUBS = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now());
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
`;

// Supabase grants table privileges to these roles by default; RLS does the rest.
const SUPABASE_GRANTS = `
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
`;

let db: PGlite;

/** Run SQL as a given Supabase role/user. Returns rows or throws the Postgres error. */
async function as<T = Record<string, unknown>>(
  who: "anon" | string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("RESET ROLE");
  if (who === "anon") {
    await db.exec(`SET request.jwt.claim.sub = ''; SET ROLE anon;`);
  } else {
    await db.exec(`SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;`);
  }
  try {
    const res = await db.query<T>(sql, params);
    return res.rows;
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}

/** Service role stand-in: the table owner, which bypasses RLS like Supabase's service key. */
const svc = (sql: string, params: unknown[] = []) => db.query(sql, params);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(SUPABASE_GRANTS);

  // Three users via the real signup trigger (first one becomes admin).
  for (const [id, username] of [
    [ADMIN, "admin"],
    [ALICE, "alice"],
    [BOB, "bob"],
  ]) {
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
      id,
      `${username}@example.test`,
      JSON.stringify({ username }),
    ]);
  }

  // Alice is a connected creator with two tips (one partly refunded, fee refunded).
  await svc(
    `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled, details_submitted)
     VALUES ($1, 'acct_alice', 'connected', true, true), ($2, 'acct_bob', 'pending', false, false)`,
    [ALICE, BOB],
  );
  await svc(
    `INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents, status, paid_at)
     VALUES ($1, 'acct_alice', 1000, 50, 1050, 'succeeded', now()),
            ($1, 'acct_alice', 2000, 50, 2050, 'succeeded', now())`,
    [ALICE],
  );
  await svc(
    `UPDATE tips SET amount_refunded_cents = 2050, platform_fee_refunded_cents = 50 WHERE tip_amount_cents = 2000`,
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("payment state is server-written only", () => {
  const forbidden: [string, string][] = [
    [
      "insert a tip",
      `INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents)
       VALUES ('${ALICE}', 'acct_alice', 500, 50, 550)`,
    ],
    [
      "mark own tip as paid",
      `UPDATE tips SET status = 'succeeded' WHERE creator_user_id = '${ALICE}' RETURNING id`,
    ],
    [
      "connect a payment account",
      `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled)
       VALUES ('${BOB}', 'acct_fake', 'connected', true)`,
    ],
    [
      "enable own charges",
      `UPDATE creator_payment_accounts SET charges_enabled = true, status = 'connected' RETURNING user_id`,
    ],
    ["write webhook events", `INSERT INTO stripe_events (id, type) VALUES ('evt_x', 'x')`],
    [
      "write checkout attempts",
      `INSERT INTO checkout_attempts (ip_hash, creator_user_id) VALUES ('h', '${BOB}')`,
    ],
  ];

  for (const [label, sql] of forbidden) {
    it(`a signed-in user cannot ${label}`, async () => {
      const who = label.includes("enable own") ? BOB : ALICE;
      const result = await as(who, sql).then(
        (rows) => ({ ok: true, rows }),
        (e: Error) => ({ ok: false, e }),
      );
      // Either RLS rejects the write outright, or the UPDATE matches no visible rows.
      if (result.ok) expect((result as { rows: unknown[] }).rows).toHaveLength(0);
      else
        expect(String((result as { e: Error }).e.message)).toMatch(
          /row-level security|permission denied/,
        );
    });
  }

  it("Bob's account row is still pending after his attempt", async () => {
    const { rows } = await svc(
      `SELECT status, charges_enabled FROM creator_payment_accounts WHERE user_id = $1`,
      [BOB],
    );
    expect(rows[0]).toEqual({ status: "pending", charges_enabled: false });
  });

  it("anonymous visitors can't read tips, accounts, events or attempts", async () => {
    for (const t of [
      "tips",
      "creator_payment_accounts",
      "stripe_events",
      "checkout_attempts",
      "tip_settings",
    ]) {
      expect(await as("anon", `SELECT * FROM ${t}`)).toHaveLength(0);
    }
  });
});

describe("creators see only their own money", () => {
  it("Alice sees her two tips; Bob sees none", async () => {
    expect(await as(ALICE, `SELECT id FROM tips`)).toHaveLength(2);
    expect(await as(BOB, `SELECT id FROM tips`)).toHaveLength(0);
  });

  it("Bob can't read Alice's payment account", async () => {
    expect(
      await as(BOB, `SELECT * FROM creator_payment_accounts WHERE user_id = '${ALICE}'`),
    ).toHaveLength(0);
    expect(await as(ALICE, `SELECT stripe_account_id FROM creator_payment_accounts`)).toEqual([
      { stripe_account_id: "acct_alice" },
    ]);
  });
});

describe("tip constraints", () => {
  it("rejects tips under $5 and totals that don't add up", async () => {
    await expect(
      svc(`INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents)
           VALUES ('${ALICE}', 'acct_alice', 499, 50, 549)`),
    ).rejects.toThrow();
    await expect(
      svc(`INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents)
           VALUES ('${ALICE}', 'acct_alice', 1000, 50, 1000)`),
    ).rejects.toThrow(/tips_total_matches/);
  });

  it("allows only one tip per checkout session", async () => {
    await svc(`INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents, checkout_session_id)
               VALUES ('${ALICE}', 'acct_alice', 500, 50, 550, 'cs_dup')`);
    await expect(
      svc(`INSERT INTO tips (creator_user_id, stripe_account_id, tip_amount_cents, platform_fee_cents, total_cents, checkout_session_id)
           VALUES ('${ALICE}', 'acct_alice', 500, 50, 550, 'cs_dup')`),
    ).rejects.toThrow();
    await svc(`DELETE FROM tips WHERE checkout_session_id = 'cs_dup'`);
  });
});

describe("tip settings", () => {
  it("a creator can create and change their own settings only", async () => {
    await as(
      ALICE,
      `INSERT INTO tip_settings (user_id, enabled, button_text) VALUES ('${ALICE}', true, 'Buy me a coffee')`,
    );
    await expect(as(ALICE, `INSERT INTO tip_settings (user_id) VALUES ('${BOB}')`)).rejects.toThrow(
      /row-level security/,
    );
    expect(
      await as(
        BOB,
        `UPDATE tip_settings SET enabled = false WHERE user_id = '${ALICE}' RETURNING user_id`,
      ),
    ).toHaveLength(0);
    await expect(
      as(ALICE, `UPDATE tip_settings SET button_text = '' WHERE user_id = '${ALICE}'`),
    ).rejects.toThrow();
  });
});

describe("admin revenue report", () => {
  it("refuses non-admins and anonymous callers", async () => {
    await expect(as(ALICE, `SELECT public.admin_tip_report()`)).rejects.toThrow(/Not authorized/);
    await expect(as("anon", `SELECT public.admin_tip_report()`)).rejects.toThrow(
      /permission denied|Not authorized/,
    );
  });

  it("gives admins the platform totals", async () => {
    const [{ admin_tip_report: r }] = await as<{ admin_tip_report: Record<string, number> }>(
      ADMIN,
      `SELECT public.admin_tip_report()`,
    );
    expect(r.successful_tips).toBe(2);
    expect(r.gross_tip_volume_cents).toBe(3000);
    expect(r.platform_fee_cents).toBe(100);
    expect(r.platform_fee_refunded_cents).toBe(50);
    expect(r.net_platform_fee_cents).toBe(50);
    expect(r.refunded_tips).toBe(1);
    expect(r.average_tip_cents).toBe(1500);
    expect(r.creators_receiving_tips).toBe(1);
    expect(r.active_connected_creators).toBe(1);
    expect(r.pending_connected_creators).toBe(1);
  });
});

describe("wishlists", () => {
  let publicId: string;
  let privateId: string;

  beforeAll(async () => {
    [{ id: publicId }] = await as<{ id: string }>(
      ALICE,
      `INSERT INTO wishlists (user_id, slug, title, visibility, show_on_profile)
       VALUES ('${ALICE}', 'birthday', 'Birthday', 'public', true) RETURNING id`,
    );
    [{ id: privateId }] = await as<{ id: string }>(
      ALICE,
      `INSERT INTO wishlists (user_id, slug, title) VALUES ('${ALICE}', 'secret-santa', 'Secret') RETURNING id`,
    );
    await as(
      ALICE,
      `INSERT INTO wishlist_items (wishlist_id, user_id, name, url) VALUES
         ('${publicId}', '${ALICE}', 'Book', 'https://shop.example.com/book'),
         ('${privateId}', '${ALICE}', 'Hidden', 'https://shop.example.com/x')`,
    );
  });

  it("visitors see public lists and their items, never private ones", async () => {
    expect((await as("anon", `SELECT slug FROM wishlists`)).map((r) => r.slug)).toEqual([
      "birthday",
    ]);
    expect((await as("anon", `SELECT name FROM wishlist_items`)).map((r) => r.name)).toEqual([
      "Book",
    ]);
    expect(await as(BOB, `SELECT * FROM wishlists WHERE id = '${privateId}'`)).toHaveLength(0);
  });

  it("the owner sees their private list", async () => {
    expect(await as(ALICE, `SELECT * FROM wishlists`)).toHaveLength(2);
  });

  it("nobody else can edit, delete or add items to Alice's lists", async () => {
    expect(
      await as(BOB, `UPDATE wishlists SET title = 'pwned' WHERE id = '${publicId}' RETURNING id`),
    ).toHaveLength(0);
    expect(
      await as(BOB, `DELETE FROM wishlists WHERE id = '${publicId}' RETURNING id`),
    ).toHaveLength(0);
    await expect(
      as(
        BOB,
        `INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ('${publicId}', '${BOB}', 'spam')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(
        BOB,
        `INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ('${publicId}', '${ALICE}', 'spam')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("only allows plain web links for items and https for images", async () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://x.example.com",
      "https://has space.com",
    ]) {
      await expect(
        as(
          ALICE,
          `INSERT INTO wishlist_items (wishlist_id, user_id, name, url) VALUES ($1, $2, 'x', $3)`,
          [publicId, ALICE, bad],
        ),
      ).rejects.toThrow();
    }
    await expect(
      as(
        ALICE,
        `INSERT INTO wishlist_items (wishlist_id, user_id, name, image_url) VALUES ($1, $2, 'x', 'http://img.example.com/a.png')`,
        [publicId, ALICE],
      ),
    ).rejects.toThrow();
    await as(
      ALICE,
      `INSERT INTO wishlist_items (wishlist_id, user_id, name, url) VALUES ($1, $2, 'ok', 'http://shop.example.com/ok')`,
      [publicId, ALICE],
    );
  });

  it("keeps slugs URL-safe and unique per user", async () => {
    await expect(
      as(
        ALICE,
        `INSERT INTO wishlists (user_id, slug, title) VALUES ('${ALICE}', 'Bad Slug', 'x')`,
      ),
    ).rejects.toThrow();
    await expect(
      as(
        ALICE,
        `INSERT INTO wishlists (user_id, slug, title) VALUES ('${ALICE}', 'birthday', 'x')`,
      ),
    ).rejects.toThrow();
    await as(
      BOB,
      `INSERT INTO wishlists (user_id, slug, title) VALUES ('${BOB}', 'birthday', 'Bob bday')`,
    );
  });
});
