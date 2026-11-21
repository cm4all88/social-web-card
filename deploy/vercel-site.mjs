/**
 * Reads `vercel deploy --json` output on stdin and prints the project's
 * lasting address: the shortest *.vercel.app alias of the deployment. (The
 * deployment's own address changes on every deploy.) Prints nothing if
 * there is no such alias.
 */
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const found = [];
  const walk = (v, key) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === "string" && /^(alias|aliases)$/i.test(key ?? "")) found.push(v.replace(/^https:\/\//, ""));
  };
  try { walk(JSON.parse(s)); } catch { /* not JSON: nothing found */ }
  const app = found.filter((h) => /^[a-z0-9-]+\.vercel\.app$/.test(h)).sort((a, b) => a.length - b.length);
  process.stdout.write(app[0] ?? "");
});
