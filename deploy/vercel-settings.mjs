/**
 * Decides which settings deploy/deploy.sh stores on the Vercel project.
 *
 * Tipping safety (Nov 21): yooits-preview's Production target serves yooits.me,
 * so adding a Stripe key to a GitHub environment must never switch tipping on
 * by itself.
 *  - TIPPING_ENABLED is stored as "true" only when the environment sets
 *    TIPPING_ENABLED=true explicitly AND the key is a Stripe TEST key.
 *  - A LIVE key never switches tipping on from a deploy. Live tipping needs
 *    the separate STRIPE_LIVE_MODE_APPROVED flag, which only the owner sets by
 *    hand in Vercel, and the app refuses live keys without it.
 *  - Without the explicit flag no Stripe key is stored and no webhooks are made.
 *
 *   node deploy/vercel-settings.mjs        prints the settings JSON (reads process.env)
 *   node deploy/vercel-settings.mjs --stripe   prints "yes" if Stripe settings should be stored
 */

export const isLiveKey = (k) => /^(sk|rk)_live_/.test(k ?? "");
export const isTestKey = (k) => /^(sk|rk)_test_/.test(k ?? "");

/** True when this deploy may store Stripe settings and switch test tipping on. */
export function stripeTestTippingOn(e) {
  const key = (e.STRIPE_SECRET_KEY ?? "").trim();
  return e.TIPPING_ENABLED === "true" && isTestKey(key);
}

export function vercelSettings(e) {
  const on = stripeTestTippingOn(e);
  const s = {
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: e.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SECRET_KEY,
    TIPPING_ENABLED: on ? "true" : "false",
    PUBLIC_SITE_URL: e.SITE,
  };
  if (on) s.STRIPE_SECRET_KEY = e.STRIPE_SECRET_KEY.trim();
  if (e.GATE === "yes") s.SITE_PASSWORD = e.SITE_PASSWORD;
  return s;
}

/** Vercel target the settings go to: production (default) or preview. */
export function vercelTarget(e) {
  const t = (e.VERCEL_ENV_TARGET ?? "production").trim();
  if (t !== "production" && t !== "preview") throw new Error(`VERCEL_ENV_TARGET must be production or preview, not ${t}`);
  return t;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (process.argv[2] === "--stripe") process.stdout.write(stripeTestTippingOn(process.env) ? "yes" : "no");
  else process.stdout.write(JSON.stringify(vercelSettings(process.env)));
}
