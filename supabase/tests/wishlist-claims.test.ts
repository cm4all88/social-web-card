/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Wishlist gift claims on in-memory Postgres with every real migration
 * applied: the switch (admins only while off), claiming and letting go,
 * one claim per item, the surprise (owner sees nothing unless they ask, and
 * nobody but the claimer learns who), visibility rules, limits, and rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const PARENT = "00000000-0000-4000-8000-0000000000a1";
const GRANDMA = "00000000-0000-4000-8000-0000000000b1";
const UNCLE = "00000000-0000-4000-8000-0000000000c1";

let db: PGlite;
let listId = "";
let privateListId = "";
const items: string[] = [];

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

const claim = (who: string | null, item: string) =>
  as<{ r: string }>(who, `SELECT public.claim_wishlist_item($1) AS r`, [item]).then((r) => r[0].r);
const unclaim = (who: string, item: string) =>
  as<{ r: boolean }>(who, `SELECT public.unclaim_wishlist_item($1) AS r`, [item]).then(
    (r) => r[0].r,
  );
const status = (who: string | null, list = listId) =>
  as<{ s: any }>(who, `SELECT public.wishlist_claim_status($1) AS s`, [list]).then((r) => r[0].s);

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
  // As in Supabase: new tables get default grants, then the migration's REVOKE applies.
  await db.exec(
    `REVOKE ALL ON public.wishlist_claim_settings, public.wishlist_item_claims FROM anon, authenticated;
     GRANT SELECT ON public.wishlist_item_claims TO authenticated;`,
  );
  await signUp(ADMIN, "boss");
  await signUp(PARENT, "mom");
  await signUp(GRANDMA, "grandma");
  await signUp(UNCLE, "uncle");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);

  const [w] = await as<{ id: string }>(
    PARENT,
    `INSERT INTO wishlists (user_id, slug, title, occasion, visibility, recipient_name)
     VALUES ($1, 'mias-christmas', 'Mia''s Christmas list', 'Christmas', 'public', 'Mia') RETURNING id`,
    [PARENT],
  );
  listId = w.id;
  const [p] = await as<{ id: string }>(
    PARENT,
    `INSERT INTO wishlists (user_id, slug, title) VALUES ($1, 'secret', 'Secret') RETURNING id`,
    [PARENT],
  );
  privateListId = p.id;
  for (const name of ["Bike", "Paint set", "Book", "Puzzle", "Pinned item"]) {
    const [it] = await as<{ id: string }>(
      PARENT,
      `INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [w.id, PARENT, name],
    );
    items.push(it.id);
  }
  await as(
    PARENT,
    `INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Hidden')`,
    [p.id, PARENT],
  );
}, 60_000);

afterAll(() => db?.close());

describe("the switch", () => {
  it("starts off for everyone but admins", async () => {
    expect(await claim(GRANDMA, items[0])).toBe("off");
    expect((await status(GRANDMA)).enabled).toBe(false);
    expect((await status(ADMIN)).enabled).toBe(true);
  });

  it("only admins can turn it on, and the change is audited", async () => {
    expect(
      await fails(as(GRANDMA, `SELECT public.owner_set_wishlist_claim_settings(true)`)),
    ).toBeTruthy();
    await as(ADMIN, `SELECT public.owner_set_wishlist_claim_settings(true)`);
    const audit = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'wishlist_claims.settings'`,
    );
    expect(audit[0].n).toBe(1);
    expect((await status(GRANDMA)).enabled).toBe(true);
  });

  it("nobody can read or write the settings or claims tables directly", async () => {
    expect(await fails(as(GRANDMA, `SELECT * FROM wishlist_claim_settings`))).toBeTruthy();
    expect(
      await fails(
        as(
          GRANDMA,
          `INSERT INTO wishlist_item_claims (item_id, wishlist_id, claimer_user_id) VALUES ($1, $2, $3)`,
          [items[0], listId, GRANDMA],
        ),
      ),
    ).toBeTruthy();
    expect(await fails(as(null, `SELECT * FROM wishlist_item_claims`))).toBeTruthy();
  });
});

describe("claiming", () => {
  it("needs a signed-in visitor who isn't the list owner", async () => {
    expect(await claim(null, items[0]).catch(() => "denied")).toBe("denied");
    expect(await claim(PARENT, items[0])).toBe("own_list");
  });

  it("lets one person claim an item and shows everyone else it's taken", async () => {
    expect(await claim(GRANDMA, items[0])).toBe("claimed");
    expect(await claim(GRANDMA, items[0])).toBe("claimed"); // idempotent for the claimer
    expect(await claim(UNCLE, items[0])).toBe("taken");

    const g = await status(GRANDMA);
    expect(g.claimed).toEqual([{ item_id: items[0], mine: true }]);
    const u = await status(UNCLE);
    expect(u.claimed).toEqual([{ item_id: items[0], mine: false }]);
    const anon = await status(null);
    expect(anon.claimed).toEqual([{ item_id: items[0], mine: false }]);
    expect(anon.enabled).toBe(true); // signed out: sees the button, which asks them to sign in
  });

  it("never tells anyone but the claimer who claimed", async () => {
    expect(JSON.stringify(await status(UNCLE))).not.toContain(GRANDMA);
    expect(await as(UNCLE, `SELECT * FROM wishlist_item_claims`)).toEqual([]);
    expect(await as(PARENT, `SELECT * FROM wishlist_item_claims`)).toEqual([]);
    const own = await as<any>(GRANDMA, `SELECT item_id FROM wishlist_item_claims`);
    expect(own).toEqual([{ item_id: items[0] }]);
  });

  it("keeps the surprise from the owner unless they turn on reveal_claims", async () => {
    const hidden = await status(PARENT);
    expect(hidden.is_owner).toBe(true);
    expect(hidden.claimed).toEqual([]);
    await as(PARENT, `UPDATE wishlists SET reveal_claims = true WHERE id = $1`, [listId]);
    const shown = await status(PARENT);
    expect(shown.claimed).toEqual([{ item_id: items[0], mine: false }]);
    expect(JSON.stringify(shown)).not.toContain(GRANDMA);
    await as(PARENT, `UPDATE wishlists SET reveal_claims = false WHERE id = $1`, [listId]);
  });

  it("lists a claimer's own gifts with where they're from", async () => {
    const [{ r }] = await as<{ r: any[] }>(GRANDMA, `SELECT public.my_wishlist_claims() AS r`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ item_name: "Bike", username: "mom", recipient_name: "Mia" });
    const [{ r: none }] = await as<{ r: any[] }>(UNCLE, `SELECT public.my_wishlist_claims() AS r`);
    expect(none).toEqual([]);
  });

  it("only the claimer can let it go", async () => {
    expect(await unclaim(UNCLE, items[0])).toBe(false);
    expect(await unclaim(PARENT, items[0])).toBe(false);
    expect(await unclaim(GRANDMA, items[0])).toBe(true);
    expect(await claim(UNCLE, items[0])).toBe("claimed");
  });

  it("caps claims per person per list", async () => {
    await as(ADMIN, `SELECT public.owner_set_wishlist_claim_settings(NULL, 2)`);
    expect(await claim(GRANDMA, items[1])).toBe("claimed");
    expect(await claim(GRANDMA, items[2])).toBe("claimed");
    expect(await claim(GRANDMA, items[3])).toBe("limit");
    await as(ADMIN, `SELECT public.owner_set_wishlist_claim_settings(NULL, 20)`);
  });

  it("refuses private lists and hidden pages, and hides their status", async () => {
    const [hidden] = await svc<{ id: string }>(
      `SELECT id FROM wishlist_items WHERE wishlist_id = $1`,
      [privateListId],
    );
    expect(await claim(GRANDMA, hidden.id)).toBe("unavailable");
    expect((await status(GRANDMA, privateListId)).claimed).toEqual([]);

    await svc(
      `INSERT INTO account_status (user_id, unpublished_at) VALUES ($1, now())
               ON CONFLICT (user_id) DO UPDATE SET unpublished_at = now()`,
      [PARENT],
    );
    expect(await claim(GRANDMA, items[4])).toBe("unavailable");
    expect((await status(GRANDMA)).claimed).toEqual([]);
    await svc(`UPDATE account_status SET unpublished_at = NULL WHERE user_id = $1`, [PARENT]);
    expect((await status(GRANDMA)).claimed.length).toBeGreaterThan(0);
  });

  it("drops claims when the owner deletes the item", async () => {
    await as(PARENT, `DELETE FROM wishlist_items WHERE id = $1`, [items[1]]);
    const [{ r }] = await as<{ r: any[] }>(GRANDMA, `SELECT public.my_wishlist_claims() AS r`);
    expect(r.map((x) => x.item_name)).toEqual(["Book"]);
  });

  it("lets the owner set who the list is for, within limits", async () => {
    expect(
      await fails(as(PARENT, `UPDATE wishlists SET recipient_name = '  ' WHERE id = $1`, [listId])),
    ).toBeTruthy();
    expect(
      await fails(
        as(PARENT, `UPDATE wishlists SET recipient_name = $2 WHERE id = $1`, [
          listId,
          "x".repeat(41),
        ]),
      ),
    ).toBeTruthy();
    const [row] = await as<any>(null, `SELECT recipient_name FROM wishlists WHERE id = $1`, [
      listId,
    ]);
    expect(row.recipient_name).toBe("Mia");
  });
});

describe("rollback", () => {
  it("removes everything the migration added", async () => {
    const down = readFileSync(
      join(__dirname, "..", "rollbacks", "20261122233000_wishlist_gift_claims.down.sql"),
      "utf8",
    );
    await db.exec(down);
    const left = await svc<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE '%wishlist_claim%' OR proname LIKE '%claim_wishlist%'`,
    );
    expect(left[0].n).toBe(0);
    const cols = await svc(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'wishlists' AND column_name IN ('recipient_name', 'reveal_claims')`,
    );
    expect(cols).toEqual([]);
    expect((await svc(`SELECT count(*)::int AS n FROM wishlist_items`))[0]).toMatchObject({ n: 5 });
  });
});
