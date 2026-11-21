// node --test deploy/check-config.test.mjs
// The connection tests also run when TEST_PG_PORT names a local Postgres with
// a login role "postgres.testref1234567890ab" whose password is PW below, and
// PG_MODULE_DIR is a folder with the "pg" package installed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { Bad, buildDbUrl, checkKeyFormats, parseDbUrl, resolveDb } from "./check-config.mjs";

const REF = "testref1234567890ab";
const PW = "p@ss:w/rd#?%&[x]";

test("repairs a pasted Session pooler string with a raw special-character password", () => {
  const p = parseDbUrl(` "postgresql://postgres.${REF}:${PW}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"\n`, REF);
  assert.equal(p.kind, "pooler");
  assert.equal(p.port, 5432);
  assert.equal(p.user, `postgres.${REF}`);
  assert.deepEqual(p.passwords, [PW]);
  const url = buildDbUrl(p, p.passwords[0]);
  assert.equal(url, `postgresql://postgres.${REF}:${encodeURIComponent(PW)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`);
  assert.equal(new URL(url).password, encodeURIComponent(PW));
});

test("keeps an already-encoded password, removes NAME= and the [ ] around it", () => {
  const enc = encodeURIComponent("abc$def");
  assert.deepEqual(parseDbUrl(`postgresql://postgres:${enc}@db.${REF}.supabase.co:5432/postgres`, REF).passwords, ["abc$def"]);
  const p = parseDbUrl(`SUPABASE_DB_URL=postgresql://postgres:[secretpw]@db.${REF}.supabase.co:5432/postgres`, REF);
  assert.equal(p.kind, "direct");
  assert.deepEqual(p.passwords, ["secretpw", "[secretpw]"]);
});

test("refuses what it can't repair, naming the problem but never the value", () => {
  const cases = [
    [`postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, /placeholder/],
    [`https://${REF}.supabase.co`, /postgresql:\/\//],
    [`postgresql://postgres.otherproject:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, /different Supabase project/],
    [`postgresql://postgres.${REF}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, /no password/],
    [`postgresql://postgres.${REF}:pw word@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, /space/],
    ["", /empty/],
  ];
  for (const [raw, msg] of cases) {
    assert.throws(() => parseDbUrl(raw, REF), (e) => e instanceof Bad && msg.test(e.message) && !e.message.includes("pw"));
  }
});

test("catches keys pasted in each other's place", () => {
  const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
  assert.equal(checkKeyFormats({ SUPABASE_PUBLISHABLE_KEY: jwt("anon"), SUPABASE_SECRET_KEY: jwt("service_role") }).length, 0);
  assert.match(checkKeyFormats({ SUPABASE_PUBLISHABLE_KEY: jwt("service_role"), SUPABASE_SECRET_KEY: jwt("service_role") }).join(" "), /secret/);
  assert.match(checkKeyFormats({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a", SUPABASE_SECRET_KEY: "sb_publishable_a" }).join(" "), /anon/);
});

const port = process.env.TEST_PG_PORT;
test("connects with the repaired string, and says when the password is wrong", { skip: !port && "no TEST_PG_PORT" }, async () => {
  const pg = createRequire(join(process.env.PG_MODULE_DIR || ".", "package.json"))("pg");
  const ok = await resolveDb(pg, `postgresql://postgres.${REF}:[${PW}]@127.0.0.1:${port}/postgres`, REF);
  assert.equal(ok.url, `postgresql://postgres.${REF}:${encodeURIComponent(PW)}@127.0.0.1:${port}/postgres?sslmode=disable`);
  await assert.rejects(resolveDb(pg, `postgresql://postgres.${REF}:wrong@127.0.0.1:${port}/postgres`, REF), /refused the password/);
  await assert.rejects(resolveDb(pg, `postgresql://postgres.${REF}:x@127.0.0.1:1/postgres`, REF), /couldn't be reached/);
});
