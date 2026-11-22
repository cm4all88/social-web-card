/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Owner Mail (migration 20261122190000_owner_mail.sql) on in-memory Postgres
 * with every real migration applied and a small stand-in for Supabase Vault:
 * tokens go to Vault only, tables are closed to browsers, sign-in states
 * work once, only admins, system email detail, and an exact rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const H = (c: string) => c.repeat(64);
const VERIFIER = "v".repeat(64);

const VAULT_STUB = `
  CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
  CREATE FUNCTION vault.create_secret(_s text, _n text, _d text) RETURNS uuid LANGUAGE sql AS
    $$ INSERT INTO vault.secrets (secret, name, description) VALUES ('enc:' || _s, _n, _d) RETURNING id $$;
  CREATE FUNCTION vault.update_secret(_id uuid, _s text) RETURNS void LANGUAGE sql AS
    $$ UPDATE vault.secrets SET secret = 'enc:' || _s WHERE id = _id $$;
  CREATE VIEW vault.decrypted_secrets AS SELECT id, name, substr(secret, 5) AS decrypted_secret FROM vault.secrets;
  REVOKE ALL ON SCHEMA vault FROM public;
`;

let db: PGlite;
const svc = <T = Record<string, any>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
async function as<T = Record<string, any>>(who: string | null, q: string, p: unknown[] = []) {
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  await db.exec(VAULT_STUB);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  // Supabase's own table grants don't reach tables a migration revoked; keep that.
  await db.exec(
    `REVOKE ALL ON public.owner_mail_accounts, public.owner_mail_oauth_states FROM anon, authenticated`,
  );
  for (const [id, u] of [
    [OWNER, "boss"],
    [ALICE, "alice"],
  ]) {
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
      id,
      `${u}@example.test`,
      JSON.stringify({ username: u }),
    ]);
  }
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 90_000);

afterAll(async () => {
  await db?.close();
});

describe("owner mail", () => {
  it("sign-in states work once and only for admins", async () => {
    expect(
      await fails(svc(`SELECT owner_mail_begin($1, $2, $3)`, [ALICE, H("a"), VERIFIER])),
    ).toMatch(/Not authorized/);
    await svc(`SELECT owner_mail_begin($1, $2, $3)`, [OWNER, H("b"), VERIFIER]);
    // a second start replaces the first
    await svc(`SELECT owner_mail_begin($1, $2, $3)`, [OWNER, H("c"), VERIFIER]);
    expect((await svc(`SELECT owner_mail_take_state($1) AS v`, [H("b")]))[0].v).toBeNull();
    const t = (await svc(`SELECT owner_mail_take_state($1) AS v`, [H("c")]))[0].v;
    expect(t).toEqual({ owner_user_id: OWNER, code_verifier: VERIFIER });
    expect((await svc(`SELECT owner_mail_take_state($1) AS v`, [H("c")]))[0].v).toBeNull();
    // expired
    await svc(`SELECT owner_mail_begin($1, $2, $3)`, [OWNER, H("d"), VERIFIER]);
    await svc(`UPDATE owner_mail_oauth_states SET expires_at = now() - interval '1 second'`);
    expect((await svc(`SELECT owner_mail_take_state($1) AS v`, [H("d")]))[0].v).toBeNull();
  });

  it("keeps the refresh token in Vault, never in the table", async () => {
    await svc(
      `SELECT owner_mail_save_token($1, 'Admin@TahomaIndustries.com', 'openid email gmail.modify', 'refresh-token-1')`,
      [OWNER],
    );
    const acct = (await svc(`SELECT * FROM owner_mail_accounts`))[0];
    expect(acct.google_email).toBe("admin@tahomaindustries.com");
    expect(JSON.stringify(acct)).not.toContain("refresh-token-1");
    expect((await svc(`SELECT secret FROM vault.secrets`))[0].secret).toBe("enc:refresh-token-1");
    expect((await svc(`SELECT owner_mail_token($1) AS t`, [OWNER]))[0].t).toBe("refresh-token-1");
    // reconnect replaces the same secret
    await svc(`SELECT owner_mail_mark_broken($1, 'invalid_grant')`, [OWNER]);
    expect((await svc(`SELECT status FROM owner_mail_accounts`))[0].status).toBe("needs_reconnect");
    await svc(
      `SELECT owner_mail_save_token($1, 'admin@tahomaindustries.com', 's', 'refresh-token-2')`,
      [OWNER],
    );
    expect(await svc(`SELECT count(*)::int AS n FROM vault.secrets`)).toEqual([{ n: 1 }]);
    expect((await svc(`SELECT owner_mail_token($1) AS t`, [OWNER]))[0].t).toBe("refresh-token-2");
    expect((await svc(`SELECT status FROM owner_mail_accounts`))[0].status).toBe("connected");
    // non-admins get nothing
    expect((await svc(`SELECT owner_mail_token($1) AS t`, [ALICE]))[0].t).toBeNull();
    expect(
      await fails(
        svc(`SELECT owner_mail_save_token($1, 'a@b.co', '', 'refresh-token-x')`, [ALICE]),
      ),
    ).toMatch(/Not authorized/);
  });

  it("browsers can't read the tables or call the token functions", async () => {
    for (const who of [OWNER, ALICE, null]) {
      expect(await fails(as(who, `SELECT * FROM owner_mail_accounts`))).toMatch(
        /permission denied/,
      );
      expect(await fails(as(who, `SELECT * FROM owner_mail_oauth_states`))).toMatch(
        /permission denied/,
      );
      expect(await fails(as(who, `SELECT owner_mail_token('${OWNER}')`))).toMatch(
        /permission denied/,
      );
      expect(
        await fails(
          as(who, `SELECT owner_mail_save_token('${OWNER}', 'a@b.co', '', 'refresh-token-z')`),
        ),
      ).toMatch(/permission denied/);
      expect(await fails(as(who, `SELECT owner_mail_forget('${OWNER}')`))).toMatch(
        /permission denied/,
      );
      expect(
        await fails(as(who, `SELECT owner_mail_begin('${OWNER}', '${H("e")}', '${VERIFIER}')`)),
      ).toMatch(/permission denied/);
    }
  });

  it("audits sends and connections", async () => {
    await svc(`SELECT owner_mail_audit($1, 'mail.sent', 'msg123', '{"recipients":1}')`, [OWNER]);
    expect(
      await fails(svc(`SELECT owner_mail_audit($1, 'mail.sent', 'm', '{}')`, [ALICE])),
    ).toMatch(/Not authorized/);
    expect(
      await fails(svc(`SELECT owner_mail_audit($1, 'users.deleted', 'm', '{}')`, [OWNER])),
    ).toMatch(/Not authorized/);
    const actions = (
      await svc(`SELECT action FROM admin_audit_log WHERE action LIKE 'mail.%' ORDER BY id`)
    ).map((r) => r.action);
    expect(actions).toEqual(["mail.connected", "mail.connected", "mail.sent"]);
  });

  it("system email detail for admins only", async () => {
    const [{ id }] = await svc(
      `INSERT INTO email_outbox (template, category, to_email, payload, dedupe_key, status, is_test)
       VALUES ('welcome', 'account', 'x@example.test', '{"username":"x"}', 'k1', 'sent', true) RETURNING id`,
    );
    await svc(`INSERT INTO email_events (outbox_id, type, detail) VALUES ($1, 'delivered', 'ok')`, [
      id,
    ]);
    const d = (await as(OWNER, `SELECT owner_email_detail($1) AS d`, [id]))[0].d;
    expect(d.template).toBe("welcome");
    expect(d.payload).toEqual({ username: "x" });
    expect(d.events.map((e: any) => e.type)).toEqual(["delivered"]);
    expect(await fails(as(ALICE, `SELECT owner_email_detail('${id}')`))).toMatch(/Not authorized/);
    expect(await fails(as(null, `SELECT owner_email_detail('${id}')`))).toMatch(
      /permission denied/,
    );
  });

  it("disconnect removes the token from Vault", async () => {
    await svc(`SELECT owner_mail_forget($1)`, [OWNER]);
    expect(await svc(`SELECT count(*)::int AS n FROM vault.secrets`)).toEqual([{ n: 0 }]);
    expect(await svc(`SELECT count(*)::int AS n FROM owner_mail_accounts`)).toEqual([{ n: 0 }]);
    expect(
      (await svc(`SELECT action FROM admin_audit_log ORDER BY id DESC LIMIT 1`))[0].action,
    ).toBe("mail.disconnected");
  });

  it("rolls back cleanly, taking any stored token with it", async () => {
    await svc(`SELECT owner_mail_save_token($1, 'a@b.co', '', 'refresh-token-3')`, [OWNER]);
    await db.exec(
      readFileSync(
        new URL("../rollbacks/20261122190000_owner_mail.down.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(await svc(`SELECT count(*)::int AS n FROM vault.secrets`)).toEqual([{ n: 0 }]);
    expect(await svc(`SELECT to_regclass('public.owner_mail_accounts') AS t`)).toEqual([
      { t: null },
    ]);
    expect(
      await svc(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'owner_mail_%' OR proname = 'owner_email_detail'`,
      ),
    ).toEqual([{ n: 0 }]);
    // and it can go back on
    await db.exec(
      readFileSync(new URL("../migrations/20261122190000_owner_mail.sql", import.meta.url), "utf8"),
    );
  });
});
