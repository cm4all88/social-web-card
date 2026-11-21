/**
 * Checks this environment's Supabase settings before anything is deployed,
 * and repairs the usual pasting mistakes in the database connection string.
 * It prints variable names and what it found, never a value.
 *
 *   node deploy/check-config.mjs --db-out FILE            checks the keys and the database,
 *                                                         writes a working connection string to FILE
 *   node deploy/check-config.mjs --offline --db-out FILE  checks the format only (DRY_RUN)
 *   node deploy/check-config.mjs --no-db                  checks the keys only (Vercel builds,
 *                                                         which don't touch the database)
 *
 * The connection string may come from SUPABASE_DB_URL or from the names the
 * Supabase–Vercel integration sets (POSTGRES_URL_NON_POOLING, POSTGRES_URL).
 * It fixes: spaces, quotes or a "NAME=" pasted around it; the [ ] left around
 * the password; special characters in the password that weren't URL-encoded;
 * the transaction pooler port 6543 (migrations need the session pooler, 5432);
 * and the direct database address, which Vercel can't reach (it's IPv6 only),
 * by finding the project's session pooler instead.
 *
 * deploy/deploy.sh runs it with PG_MODULE_DIR pointing at a folder where the
 * "pg" package is installed (it isn't one of the app's own dependencies).
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export class Bad extends Error {}

const DB_SOURCES = ["SUPABASE_DB_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL"];
const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
];
export const POOLER_HOSTS = ["aws-0", "aws-1"].flatMap((p) => REGIONS.map((r) => `${p}-${r}.pooler.supabase.com`));

/** Decodes %xx escapes when the text is already URL-encoded; otherwise returns it as it is. */
function decodeMaybe(s) {
  if (!/%[0-9a-f]{2}/i.test(s) || /%(?![0-9a-f]{2})/i.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Reads a Postgres connection string the way people paste it and returns the
 * parts, the passwords to try (in order) and the repairs it made.
 * Throws Bad, with a message that holds no part of the value, when it can't.
 */
export function parseDbUrl(raw, ref) {
  const fixes = [];
  let s = String(raw ?? "");
  if (s.trim() !== s) fixes.push("removed spaces or line breaks around it");
  s = s.trim();
  const named = s.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*([\s\S]*)$/);
  if (named) {
    s = named[2].trim();
    fixes.push(`removed "${named[1]}=" pasted in front of it`);
  }
  const psql = s.match(/^psql\s+(?:-d\s+)?([\s\S]*)$/);
  if (psql) {
    s = psql[1].trim();
    fixes.push('removed "psql" pasted in front of it');
  }
  const quoted = s.match(/^(['"`])([\s\S]*)\1$/);
  if (quoted) {
    s = quoted[2].trim();
    fixes.push("removed quotes around it");
  }
  if (!s) throw new Bad("is empty");
  if (/\s/.test(s)) throw new Bad("has a space or line break inside it; copy the string again in one piece");
  const scheme = s.match(/^postgres(?:ql)?:\/\//i);
  if (!scheme) throw new Bad("doesn't start with postgresql:// (copy the whole string from Supabase > Connect)");
  const rest = s.slice(scheme[0].length);
  const at = rest.lastIndexOf("@");
  if (at < 0) throw new Bad("has no user name and password in it (expected postgresql://user:password@host:port/postgres)");
  const userinfo = rest.slice(0, at);
  const hostpart = rest.slice(at + 1);
  const colon = userinfo.indexOf(":");
  if (colon < 0) throw new Bad("has no password in it (expected postgresql://user:password@host:port/postgres)");
  let user = decodeMaybe(userinfo.slice(0, colon));
  const rawPassword = userinfo.slice(colon + 1);
  if (!rawPassword) throw new Bad("has an empty password");
  if (/YOUR[-_ ]?PASSWORD/i.test(rawPassword)) {
    throw new Bad("still has the [YOUR-PASSWORD] placeholder; put the database password in its place");
  }
  const password = decodeMaybe(rawPassword);
  if (password === rawPassword && encodeURIComponent(password) !== rawPassword) {
    fixes.push("URL-encoded the special characters in the password");
  }
  const passwords = [password];
  if (/^\[.+\]$/.test(password)) {
    passwords.unshift(password.slice(1, -1));
    fixes.push("the password still has the [ ] from the placeholder around it; trying it without them first");
  }

  const hp = hostpart.match(/^([A-Za-z0-9.-]+)(?::(\d*))?(?:\/([^?#]*))?(?:\?([^#]*))?(?:#.*)?$/);
  if (!hp) throw new Bad("doesn't have host:port/database after the @");
  const host = hp[1].toLowerCase();
  let port = Number(hp[2] || 5432);
  const db = decodeMaybe(hp[3] || "") || "postgres";
  if (hp[4]) fixes.push("dropped the extra settings after the ?");

  let kind = "other";
  if (host === `db.${ref}.supabase.co`) kind = "direct";
  else if (host.endsWith(".pooler.supabase.com")) kind = "pooler";
  else if (/\.supabase\.(co|com)$/.test(host)) kind = "supabase";
  if (!host.includes(ref) && !user.includes(ref)) {
    throw new Bad(`is for a different Supabase project than SUPABASE_URL (${ref})`);
  }
  if (kind === "pooler") {
    if (port === 6543) {
      port = 5432;
      fixes.push("switched the transaction pooler port 6543 to the session pooler port 5432, which migrations need");
    }
    if (user === "postgres") {
      user = `postgres.${ref}`;
      fixes.push(`the pooler needs the user name postgres.${ref}; used that`);
    }
  }
  return { kind, host, port, user, db, passwords, fixes };
}

/** Builds the connection string for the Supabase CLI, with every part URL-encoded. */
export function buildDbUrl({ host, port, user, db, ssl }, password) {
  const sslmode = ssl === false ? "disable" : "require";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}?sslmode=${sslmode}`;
}

/** Sorts a connection error into a reason, without copying the value into it. */
export function classify(e) {
  const msg = String(e?.message || "");
  const code = String(e?.code || "");
  if (code === "28P01" || /password authentication failed/i.test(msg)) return "password";
  if (/tenant or user not found/i.test(msg)) return "tenant";
  if (/does not support SSL/i.test(msg)) return "nossl";
  if (/too many|circuit breaker|max client|banned/i.test(msg)) return "busy";
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|EADDRNOTAVAIL|timeout|terminated/i.test(`${code} ${msg}`)) {
    return "unreachable";
  }
  return `other (${code || msg.replace(/[^\w .:-]/g, "").slice(0, 80)})`;
}

async function tryConnect(pg, target, password, ssl = true) {
  const client = new pg.Client({
    host: target.host, port: target.port, user: target.user, password, database: target.db,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8000, query_timeout: 8000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true, target: { ...target, ssl } };
  } catch (e) {
    const why = classify(e);
    if (why === "nossl" && ssl) return tryConnect(pg, target, password, false);
    return { ok: false, why, target };
  } finally {
    client.end().catch(() => {});
  }
}

const REASONS = {
  password: "the database refused the password",
  unreachable: "the database address couldn't be reached from here",
  tenant: "the pooler doesn't know this project",
  busy: "the pooler is refusing connections for now (too many failed tries); wait a few minutes and redeploy",
};
const reason = (why) => REASONS[why] || `the connection failed: ${why}`;

/** Finds a connection that works for one pasted value. Returns { url, notes } or throws Bad. */
export async function resolveDb(pg, raw, ref, log = () => {}) {
  const p = parseDbUrl(raw, ref);
  const notes = [...p.fixes];
  const withPasswords = async (target) => {
    let last;
    for (const pw of p.passwords) {
      last = await tryConnect(pg, target, pw);
      if (last.ok) return { ...last, password: pw };
      if (last.why !== "password") return last;
    }
    return last;
  };
  let result = await withPasswords(p);
  if (!result.ok && p.kind === "direct" && result.why === "unreachable") {
    notes.push("the direct database address isn't reachable from here (it's IPv6 only), so I looked for the project's session pooler");
    log("looking for the project's session pooler");
    const pooled = { ...p, kind: "pooler", port: 5432, user: `postgres.${ref}` };
    const first = await Promise.all(POOLER_HOSTS.map((host) => tryConnect(pg, { ...pooled, host }, p.passwords[0])));
    const found = first.find((r) => r.ok) || first.find((r) => r.why === "password" || r.why === "busy");
    if (!found) {
      throw new Bad("points at the direct database address, which isn't reachable from here, and I couldn't find the project's session pooler");
    }
    result = found.ok ? { ...found, password: p.passwords[0] } : found.why === "password" ? await withPasswords(found.target) : found;
    if (result.ok || result.target) notes.push(`using the session pooler ${result.target.host}`);
  }
  if (!result.ok) throw new Bad(reason(result.why));
  return { url: buildDbUrl(result.target, result.password), notes };
}

// --- Keys ----------------------------------------------------------------------------------------
function jwtRole(key) {
  const part = String(key).split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

/** Format checks that need no network. Returns a list of problems. */
export function checkKeyFormats(env) {
  const problems = [];
  const pub = env.SUPABASE_PUBLISHABLE_KEY || "";
  const sec = env.SUPABASE_SECRET_KEY || "";
  if (pub.startsWith("sb_secret_") || jwtRole(pub) === "service_role") {
    problems.push("SUPABASE_PUBLISHABLE_KEY holds the secret (service role) key. That key would be sent to every browser. Use the anon / publishable key there.");
  }
  if (sec && (sec.startsWith("sb_publishable_") || jwtRole(sec) === "anon")) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY holds the public anon / publishable key. Use the service_role / secret key there.");
  }
  if (sec && sec === pub) problems.push("SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY are the same key.");
  return problems;
}

async function checkKeys(env, warn) {
  const url = env.SUPABASE_URL;
  const problems = [];
  problems.checked = true;
  const get = async (path, key) => {
    const res = await fetch(url + path, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
  };
  try {
    const s = await get("/auth/v1/settings", env.SUPABASE_PUBLISHABLE_KEY);
    if (s.status === 401 || s.status === 403) {
      problems.push(`SUPABASE_PUBLISHABLE_KEY isn't accepted by Supabase project ${env.REF}. Copy the anon / publishable key again.`);
    } else if (s.body && s.body.mailer_autoconfirm === false) {
      warn("this Supabase project asks new users to confirm their email, so the sign-up test will fail. Turn off Authentication > Sign In / Providers > Email > Confirm email.");
    }
    const a = await get("/auth/v1/admin/users?page=1&per_page=1", env.SUPABASE_SECRET_KEY);
    if (a.status === 401 || a.status === 403) {
      problems.push(`SUPABASE_SERVICE_ROLE_KEY isn't accepted by Supabase project ${env.REF}. Copy the service_role / secret key again.`);
    }
  } catch {
    warn(`couldn't reach ${url} to check the keys; carrying on`);
    problems.checked = false;
  }
  return problems;
}

// --- Main ----------------------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const out = args.includes("--db-out") ? args[args.indexOf("--db-out") + 1] : null;
  const env = process.env;
  const name = env.YOOITS_ENV || "?";
  const say = (s) => console.error(`deploy ${name}: ${s}`);
  const where = env.VERCEL === "1"
    ? `Vercel project ${env.PROJECT_NAME} > Settings > Environment Variables (for ${env.VERCEL_ENV === "production" ? "Production" : "Preview"})`
    : `the "${name}" secrets`;
  const stop = (lines) => {
    say("STOPPED before changing anything. What to fix:");
    for (const l of lines) console.error(`  - ${l}`);
    console.error(`  Change it in ${where}, then redeploy.`);
    process.exit(1);
  };

  const ref = (env.SUPABASE_URL || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!ref) stop(["SUPABASE_URL should look like https://<project id>.supabase.co"]);
  env.REF = ref;

  const problems = checkKeyFormats(env);
  const online = offline ? null : await checkKeys(env, (w) => say(`warning: ${w}`));
  if (online) problems.push(...online);
  if (problems.length) stop(problems);
  say(online?.checked ? "keys: accepted by Supabase" : "keys: format OK (not checked online)");

  if (args.includes("--no-db")) return;
  const sources = DB_SOURCES.filter((n) => (env[n] || "").trim());
  if (!sources.length) stop(["SUPABASE_DB_URL isn't set. Use the Session pooler connection string from Supabase > Connect, with the database password in it."]);
  const pg = offline ? null : createRequire(join(env.PG_MODULE_DIR || ".", "package.json"))("pg");
  const failures = [];
  for (const source of sources) {
    try {
      let url;
      let notes;
      if (offline) {
        const p = parseDbUrl(env[source], ref);
        url = buildDbUrl(p, p.passwords[0]);
        notes = [...p.fixes, "not connected (dry run)"];
      } else {
        ({ url, notes } = await resolveDb(pg, env[source], ref, (s) => say(`${source}: ${s}`)));
      }
      say(`database: ${source} works${notes.length ? `; ${notes.join("; ")}` : ""}`);
      if (out) writeFileSync(out, url, { mode: 0o600 });
      return;
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      failures.push(`${source} ${e.message}.`);
    }
  }
  if (failures.some((f) => /password|placeholder/.test(f))) {
    failures.push(`If you don't know the database password, reset it in Supabase (project ${ref}) > Database > Settings, then paste the Session pooler string again with the new password.`);
  } else {
    failures.push(`The right value is in Supabase (project ${ref}) > Connect > Session pooler, with the database password in place of [YOUR-PASSWORD].`);
  }
  stop(failures);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`deploy: the settings check itself failed (${e?.name || "error"}); see deploy/check-config.mjs`);
    process.exit(1);
  });
}
