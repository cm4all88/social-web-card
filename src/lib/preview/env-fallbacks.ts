/**
 * The server reads SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SERVICE_ROLE_KEY. When the host stores them under the names the
 * Supabase–Vercel integration uses, or with stray spaces or quotes pasted
 * around them, this fills in the names the app reads. deploy/deploy.sh accepts
 * the same names at build time.
 */
const ALIASES: Record<string, string[]> = {
  SUPABASE_URL: ["NEXT_PUBLIC_SUPABASE_URL"],
  SUPABASE_PUBLISHABLE_KEY: [
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ],
  SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SECRET_KEY"],
};

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const quoted = v.match(/^(['"])([\s\S]*)\1$/);
  return (quoted ? quoted[2].trim() : v) || undefined;
}

export function applySupabaseEnvFallbacks(env: Record<string, string | undefined>): void {
  for (const [name, aliases] of Object.entries(ALIASES)) {
    let value = [name, ...aliases].map((n) => clean(env[n])).find(Boolean);
    if (!value) continue;
    if (name === "SUPABASE_URL") value = value.replace(/\/+$/, "");
    env[name] = value;
  }
}
