/**
 * Stores settings on the Vercel project linked in .vercel/project.json, for
 * its production deployments. Reads a JSON object of NAME: value pairs on
 * stdin and passes each value to `vercel env add` on stdin, so no secret
 * ever appears in a command line or log:
 *   printf '%s' '{"A":"1"}' | node deploy/vercel-env.mjs
 * Needs VERCEL_TOKEN (and VERCEL_SCOPE for a team account).
 */
import { spawnSync } from "node:child_process";

const input = await new Promise((resolve) => {
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => resolve(s));
});
const vars = JSON.parse(input || "{}");
const scope = process.env.VERCEL_SCOPE ? ["--scope", process.env.VERCEL_SCOPE] : [];
for (const [name, value] of Object.entries(vars)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== "string" || value === "") {
    console.error(`vercel-env: skipping bad setting ${name}`);
    process.exit(1);
  }
  const r = spawnSync(
    "npx",
    ["-y", "vercel@66.6.0", "env", "add", name, "--environment", "production", "--force", "--sensitive", "--yes",
     "--token", process.env.VERCEL_TOKEN ?? "", ...scope],
    { input: value, stdio: ["pipe", "ignore", "inherit"] },
  );
  if (r.status !== 0) {
    console.error(`vercel-env: couldn't store ${name}`);
    process.exit(1);
  }
}
console.log(`vercel-env: stored ${Object.keys(vars).length} settings`);
