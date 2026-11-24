import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { profileBlocks } from "../../src/lib/profile-blocks";

it("preserves existing layouts and allows only an owner to store a valid block order", async () => {
  const db = new PGlite();
  const old = "00000000-0000-4000-8000-000000000b01";
  const owner = "00000000-0000-4000-8000-000000000b02";
  const signup = (id: string, username: string) =>
    db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)", [
      id,
      `${username}@example.test`,
      JSON.stringify({ username }),
    ]);
  const layout = (id: string) =>
    db
      .query<{ profile_blocks: string[] | null }>(
        "SELECT profile_blocks FROM public.profiles WHERE user_id=$1",
        [id],
      )
      .then((result) => result.rows[0]?.profile_blocks);
  try {
    await db.exec(SUPABASE_STUBS);
    await db.exec(
      "ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz",
    );
    const migrations = migrationSql();
    const blocks = migrations.findIndex((sql) => sql.includes("ADD COLUMN profile_blocks"));
    expect(blocks).toBeGreaterThan(0);
    for (const sql of migrations.slice(0, blocks)) await db.exec(sql);
    await signup(old, "existing-blocks");
    for (const sql of migrations.slice(blocks)) await db.exec(sql);
    await db.exec(SUPABASE_GRANTS);
    await signup(owner, "new-blocks");
    expect(await layout(old)).toBeNull();
    expect(profileBlocks(await layout(old))).toEqual(["links", "wishlists", "posts"]);
    expect(await layout(owner)).toEqual(["links"]);
    await db.exec(`SET request.jwt.claim.sub = '${owner}'; SET ROLE authenticated;`);
    const result = await db.query(
      "UPDATE public.profiles SET profile_blocks=ARRAY['posts','links'] WHERE user_id=$1 RETURNING user_id",
      [old],
    );
    expect(result.rows).toEqual([]);
    await db.query(
      "UPDATE public.profiles SET profile_blocks=ARRAY['wishlists','links'] WHERE user_id=$1",
      [owner],
    );
    expect(await layout(owner)).toEqual(["wishlists", "links"]);
    for (const invalid of ["ARRAY['other']", "ARRAY['links','links']", "ARRAY['links',NULL]"]) {
      await expect(
        db.query(`UPDATE public.profiles SET profile_blocks=${invalid} WHERE user_id=$1`, [owner]),
      ).rejects.toThrow("profiles_blocks_valid");
    }
    await db.query("UPDATE public.profiles SET profile_blocks=ARRAY[]::text[] WHERE user_id=$1", [
      owner,
    ]);
    expect(profileBlocks(await layout(owner))).toEqual([]);
    await db.exec("RESET ROLE; SET ROLE anon;");
    expect(await layout(owner)).toEqual([]);
  } finally {
    await db.close();
  }
}, 60_000);
