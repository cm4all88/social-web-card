/**
 * The server-side gate every public tip button and Stripe checkout goes
 * through (loadCreatorByUsername), run against the real migrations. Turning
 * tips off, unpublishing the page or suspending the account must make the
 * creator ineligible at once, whatever the browser sends.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { pgliteAdmin } from "./pglite-admin";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy(
    {},
    { get: (_t, prop) => (holder.client as Record<string | symbol, unknown>)[prop] },
  ),
}));

import { loadCreatorByUsername } from "@/lib/tipping/functions";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;

async function asOwner(q: string, p: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub = '${OWNER}'; SET ROLE authenticated;`);
  try {
    await db.query(q, p);
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}
const eligible = async () => (await loadCreatorByUsername("alice"))?.eligible;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  holder.client = pgliteAdmin(db);
  for (const [id, u] of [
    [OWNER, "boss"],
    [ALICE, "alice"],
  ])
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
      id,
      `${u}@example.test`,
      JSON.stringify({ username: u }),
    ]);
  await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await db.query(`INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://alice.example', $1)`, [ALICE]);
  await db.query(
    `INSERT INTO tip_settings (user_id, enabled, creator_type, offering, attested_at)
     VALUES ($1, true, 'artist', 'Original prints and comics', now())`,
    [ALICE],
  );
  await db.query(
    `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled)
     VALUES ($1, 'acct_test', 'connected', true)`,
    [ALICE],
  );
}, 60_000);

afterAll(() => db?.close());

describe("server-side tip gate", () => {
  it("allows an eligible creator", async () => {
    expect(await eligible()).toBe(true);
  });

  it.each([
    ["tips turned off", "owner_set_tips_disabled"],
    ["page unpublished", "owner_set_unpublished"],
    ["account suspended", "owner_set_suspended"],
  ])("blocks checkout when %s, and allows it again when restored", async (_label, fn) => {
    await asOwner(`SELECT public.${fn}($1, true, 'Test reason')`, [ALICE]);
    expect(await eligible()).toBe(false);
    await asOwner(`SELECT public.${fn}($1, false)`, [ALICE]);
    expect(await eligible()).toBe(true);
    // Suspending switches the creator's own tip setting off; they turn it back on.
    await db.query(`UPDATE tip_settings SET enabled = true WHERE user_id = $1`, [ALICE]);
  });

  it("fails closed when the check can't run", async () => {
    const real = holder.client;
    holder.client = {
      ...(real as object),
      from: (real as { from: unknown }).from,
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await eligible()).toBe(false);
    } finally {
      holder.client = real;
      spy.mockRestore();
    }
  });
});
