/**
 * Loads test accounts and content into the PREVIEW Supabase project.
 * Safe to run again: it only adds what's missing and resets the test
 * accounts' password to PREVIEW_PASSWORD. Never point it at production;
 * preview/deploy.sh checks that before calling it.
 *
 * Accounts (all use PREVIEW_PASSWORD):
 *   owner@example.com  @previewowner  Yooits admin (Owner console)
 *   alice@example.com  @alice         creator with links, a public wishlist and tip setup
 *   bob@example.com    @bob           creator with a private wishlist
 *   casey@example.com  @casey         plain account to try the account controls on
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.PREVIEW_SUPABASE_URL;
const key = process.env.PREVIEW_SUPABASE_SECRET_KEY;
const password = process.env.PREVIEW_PASSWORD;
if (!url || !key || !password) {
  console.error("seed: PREVIEW_SUPABASE_URL, PREVIEW_SUPABASE_SECRET_KEY and PREVIEW_PASSWORD are required");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PEOPLE = [
  { email: "owner@example.com", username: "previewowner", display: "Preview Owner", admin: true },
  { email: "alice@example.com", username: "alice", display: "Alice Rivera", bio: "Illustrator. Prints, comics and the odd mural." },
  { email: "bob@example.com", username: "bob", display: "Bob Okafor", bio: "Home cook sharing weeknight recipes." },
  { email: "casey@example.com", username: "casey", display: "Casey Lin", bio: "Test account for suspend and unpublish." },
];

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const data = await must("list users", db.auth.admin.listUsers({ page, perPage: 200 }));
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(p) {
  const existing = await findUser(p.email);
  if (existing) {
    await must(`reset ${p.email}`, db.auth.admin.updateUserById(existing.id, { password, email_confirm: true }));
    return existing.id;
  }
  const data = await must(
    `create ${p.email}`,
    db.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { username: p.username, display_name: p.display },
    }),
  );
  return data.user.id;
}

async function count(table, filter) {
  let q = db.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count: n, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return n ?? 0;
}

async function ensureWishlist(userId, w, items) {
  let { data: row, error } = await db
    .from("wishlists")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", w.slug)
    .maybeSingle();
  if (error) throw new Error(`wishlist: ${error.message}`);
  if (!row) row = await must("add wishlist", db.from("wishlists").insert({ user_id: userId, ...w }).select("id").single());
  if ((await count("wishlist_items", { wishlist_id: row.id })) === 0) {
    await must(
      "add wishlist items",
      db.from("wishlist_items").insert(items.map((it, i) => ({ ...it, wishlist_id: row.id, user_id: userId, display_order: i }))),
    );
  }
}

const ids = {};
for (const p of PEOPLE) {
  ids[p.username] = await ensureUser(p);
  if (p.bio) await must(`profile ${p.username}`, db.from("profiles").update({ bio: p.bio }).eq("user_id", ids[p.username]));
  if (p.admin) {
    await must(
      "grant admin",
      db.from("user_roles").upsert({ user_id: ids[p.username], role: "admin" }, { onConflict: "user_id,role", ignoreDuplicates: true }),
    );
  }
}

const LINKS = {
  alice: [
    ["instagram", "https://instagram.com/example"],
    ["website", "https://example.com/alice"],
  ],
  bob: [["youtube", "https://youtube.com/@example"]],
  casey: [["website", "https://example.com/casey"]],
};
for (const [username, links] of Object.entries(LINKS)) {
  const userId = ids[username];
  if ((await count("social_links", { user_id: userId })) === 0) {
    await must(
      `links ${username}`,
      db.from("social_links").insert(links.map(([platform, u], i) => ({ user_id: userId, platform, url: u, display_order: i }))),
    );
  }
}

await ensureWishlist(
  ids.alice,
  { slug: "studio", title: "Studio wishlist", description: "Things that would help me make more prints.", visibility: "public", show_on_profile: true },
  [
    { name: "A3 drawing tablet", price_text: "$180", url: "https://example.com/tablet" },
    { name: "Archival ink set", price_text: "$45" },
    { name: "Screen printing frame", price_text: "$60" },
  ],
);
await ensureWishlist(
  ids.bob,
  { slug: "kitchen", title: "Kitchen upgrades", visibility: "private", show_on_profile: false },
  [{ name: "Cast iron pan", price_text: "$40" }],
);

// Alice is ready to connect Stripe (test mode) from her dashboard; tips stay off until she does.
await must(
  "tip settings",
  db.from("tip_settings").upsert(
    {
      user_id: ids.alice,
      creator_type: "artist",
      offering: "Original prints, comics and commissions",
      attested_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  ),
);

console.log("seed: test accounts ready:", PEOPLE.map((p) => `${p.email} (@${p.username}${p.admin ? ", admin" : ""})`).join(", "));
