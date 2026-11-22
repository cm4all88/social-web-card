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

describe("owner approval (default not approved)", () => {
  it("a new creator is not approved, so no tips, even when everything else is ready", async () => {
    const c = await loadCreatorByUsername("alice");
    expect(c?.approved).toBe(false);
    expect(c?.eligible).toBe(false);
  });

  it("only an admin can approve", async () => {
    await db.exec(`SET request.jwt.claim.sub = '${ALICE}'; SET ROLE authenticated;`);
    try {
      await expect(db.query(`SELECT public.owner_set_tips_approved($1, true, 'Self approve')`, [ALICE])).rejects.toThrow(
        /Not authorized/,
      );
      // ...and the creator can't write the column directly either.
      // (No write policy: an UPDATE touches nothing, an INSERT is refused.)
      await db.query(`UPDATE account_status SET tips_approved_at = now() WHERE user_id = $1`, [ALICE]);
      await expect(
        db.query(`INSERT INTO account_status (user_id, tips_approved_at) VALUES ($1, now())`, [ALICE]),
      ).rejects.toThrow();
      // tips_approved itself is server-only.
      await expect(db.query(`SELECT public.tips_approved($1)`, [ALICE])).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
    }
    expect(await eligible()).toBe(false);
  });

  it("approval needs a note, is audit-logged, and opens tips", async () => {
    await expect(asOwner(`SELECT public.owner_set_tips_approved($1, true, '')`, [ALICE])).rejects.toThrow(/reason/);
    await asOwner(`SELECT public.owner_set_tips_approved($1, true, 'Original prints, page checked')`, [ALICE]);
    expect(await eligible()).toBe(true);
    const { rows } = await db.query<{ action: string; details: { note: string } }>(
      `SELECT action, details FROM admin_audit_log WHERE target_id = $1 ORDER BY id DESC LIMIT 1`,
      [ALICE],
    );
    expect(rows[0]).toMatchObject({ action: "tipping.approved", details: { note: "Original prints, page checked" } });
  });

  it("withdrawing approval stops tips at once and is audit-logged", async () => {
    await asOwner(`SELECT public.owner_set_tips_approved($1, false, 'Re-checking page')`, [ALICE]);
    expect(await eligible()).toBe(false);
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE target_id = $1 ORDER BY id DESC LIMIT 1`,
      [ALICE],
    );
    expect(rows[0].action).toBe("tipping.approval_revoked");
    await asOwner(`SELECT public.owner_set_tips_approved($1, true, 'Checked again')`, [ALICE]);
    expect(await eligible()).toBe(true);
  });

  it("the owner sees approval in the user detail and the approvals list", async () => {
    await db.exec(`SET request.jwt.claim.sub = '${OWNER}'; SET ROLE authenticated;`);
    try {
      const { rows } = await db.query<{ d: { status: { tips_approved_at: string | null; tips_approved_by: string } } }>(
        `SELECT public.owner_get_user($1) AS d`,
        [ALICE],
      );
      expect(rows[0].d.status.tips_approved_at).not.toBeNull();
      expect(rows[0].d.status.tips_approved_by).toBe("boss");
      const list = await db.query<{ username: string; approved_at: string | null }>(
        `SELECT username, approved_at FROM public.owner_list_tip_approvals()`,
      );
      expect(list.rows.find((r) => r.username === "alice")?.approved_at).not.toBeNull();
    } finally {
      await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
    }
  });

  it("a non-admin can't list approvals", async () => {
    await db.exec(`SET request.jwt.claim.sub = '${ALICE}'; SET ROLE authenticated;`);
    try {
      await expect(db.query(`SELECT * FROM public.owner_list_tip_approvals()`)).rejects.toThrow(/Not authorized/);
    } finally {
      await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
    }
  });
});

describe("server-side tip gate", () => {
  it("allows an eligible, approved creator", async () => {
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
