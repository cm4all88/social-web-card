/**
 * Downloads every file in every storage bucket of one Supabase project into
 * a folder, with a manifest of the buckets and files:
 *   node deploy/storage-backup.mjs <folder>
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY. Database backups don't include
 * file contents, so deploy/backup.sh runs this next to the database dump.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [outDir] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!outDir || !url || !key) {
  console.error("storage-backup: usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node deploy/storage-backup.mjs <folder>");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const root = path.resolve(outDir);

// Never write outside the backup folder, whatever a file is called.
function target(bucket, name) {
  const p = path.resolve(root, "files", bucket, name);
  if (!p.startsWith(path.join(root, "files", bucket) + path.sep)) throw new Error(`unsafe file name in ${bucket}: ${name}`);
  return p;
}

async function listAll(bucket, prefix = "") {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) found.push(...(await listAll(bucket, name))); // a folder
      else found.push({ name, size: item.metadata?.size ?? null, type: item.metadata?.mimetype ?? null, updated_at: item.updated_at });
    }
    if (data.length < 1000) return found;
  }
}

const { data: buckets, error } = await db.storage.listBuckets();
if (error) { console.error(`storage-backup: ${error.message}`); process.exit(1); }
const manifest = { taken_at: new Date().toISOString(), buckets: [] };
let count = 0;
for (const b of buckets) {
  const files = await listAll(b.id);
  for (const f of files) {
    const { data, error: dlErr } = await db.storage.from(b.id).download(f.name);
    if (dlErr) throw new Error(`downloading ${b.id}/${f.name}: ${dlErr.message}`);
    const dest = target(b.id, f.name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await data.arrayBuffer()));
    count++;
  }
  manifest.buckets.push({
    id: b.id, public: b.public, file_size_limit: b.file_size_limit ?? null,
    allowed_mime_types: b.allowed_mime_types ?? null, files,
  });
}
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "storage-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`storage-backup: ${count} files from ${buckets.length} buckets`);
