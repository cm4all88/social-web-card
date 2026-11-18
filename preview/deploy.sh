#!/usr/bin/env bash
# Deploys the Yooits PREVIEW (never production):
#   1. checks every setting points at preview resources and Stripe test mode
#   2. applies database migrations to the preview Supabase project
#   3. loads test accounts and content
#   4. builds the site against the preview database
#   5. deploys it as the "yooits-preview" Cloudflare Worker and stores its secrets
#   6. creates the Stripe test webhooks the first time
# Settings come from the environment (GitHub Actions) or preview/preview.env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKER=yooits-preview
[ -f preview/preview.env.local ] && set -a && . preview/preview.env.local && set +a

fail() { echo "preview: $*" >&2; exit 1; }
need() { [ -n "${!1:-}" ] || fail "$1 is not set (see preview/README.md)"; }
for v in PREVIEW_SUPABASE_URL PREVIEW_SUPABASE_PUBLISHABLE_KEY PREVIEW_SUPABASE_SECRET_KEY PREVIEW_SUPABASE_DB_URL \
         PREVIEW_STRIPE_SECRET_KEY PREVIEW_PASSWORD CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do need "$v"; done
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# --- 1. Safety checks: nothing may point at production or Stripe live mode ----
PROD_REF=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)
[ -n "$PROD_REF" ] || fail "couldn't read the production project id from supabase/config.toml"
jwt_ref() { # prints the "ref" inside a legacy Supabase JWT key, if any
  local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  printf '%s' "$p" | base64 -d 2>/dev/null | sed -n 's/.*"ref":"\([^"]*\)".*/\1/p'
}
for v in PREVIEW_SUPABASE_URL PREVIEW_SUPABASE_DB_URL PREVIEW_SUPABASE_PUBLISHABLE_KEY PREVIEW_SUPABASE_SECRET_KEY; do
  case "${!v}" in *"$PROD_REF"*) fail "$v points at the production Supabase project. Use the preview project.";; esac
done
for v in PREVIEW_SUPABASE_PUBLISHABLE_KEY PREVIEW_SUPABASE_SECRET_KEY; do
  [ "$(jwt_ref "${!v}")" != "$PROD_REF" ] || fail "$v belongs to the production Supabase project."
done
PREVIEW_REF=$(printf '%s' "$PREVIEW_SUPABASE_URL" | sed -n 's#^https://\([a-z0-9]*\)\.supabase\.co/*$#\1#p')
[ -n "$PREVIEW_REF" ] || fail "PREVIEW_SUPABASE_URL should look like https://<project>.supabase.co"
case "$PREVIEW_SUPABASE_DB_URL" in *"$PREVIEW_REF"*) ;; *) fail "PREVIEW_SUPABASE_DB_URL isn't for the same project as PREVIEW_SUPABASE_URL";; esac
[[ "$PREVIEW_STRIPE_SECRET_KEY" =~ ^(sk|rk)_test_ ]] || fail "PREVIEW_STRIPE_SECRET_KEY must be a Stripe TEST key (sk_test_...)."
[ ${#PREVIEW_PASSWORD} -ge 12 ] || fail "PREVIEW_PASSWORD must be at least 12 characters."
unset STRIPE_LIVE_MODE_APPROVED
echo "preview: settings point at preview project $PREVIEW_REF and Stripe test mode"

# --- 2. Database migrations (only ones not applied yet) ------------------------
npx -y supabase@2 db push --db-url "$PREVIEW_SUPABASE_DB_URL" --yes

# --- 3. Test accounts and content ----------------------------------------------
PREVIEW_SUPABASE_URL="$PREVIEW_SUPABASE_URL" PREVIEW_SUPABASE_SECRET_KEY="$PREVIEW_SUPABASE_SECRET_KEY" \
  PREVIEW_PASSWORD="$PREVIEW_PASSWORD" node preview/seed.mjs

# --- 4. Build against the preview database --------------------------------------
cat > .env.preview.local <<ENV
VITE_SUPABASE_URL=$PREVIEW_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$PREVIEW_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID=$PREVIEW_REF
ENV
trap 'rm -f .env.preview.local' EXIT
rm -rf dist .wrangler
LOVABLE_SANDBOX=1 npx vite build --mode preview
if grep -rq "$PROD_REF" dist; then fail "the build still contains the production project id; not deploying"; fi
[ -f dist/server/wrangler.json ] || fail "the build didn't produce dist/server/wrangler.json"

# --- 5. Deploy and store secrets ------------------------------------------------
OUT=$(npx -y wrangler@4 deploy --config dist/server/wrangler.json --name "$WORKER" 2>&1 | tee /dev/stderr)
SITE=$(printf '%s' "$OUT" | grep -oE "https://$WORKER\.[a-z0-9-]+\.workers\.dev" | head -1)
[ -n "$SITE" ] || fail "deployed, but couldn't find the workers.dev address in Wrangler's output. Is a workers.dev subdomain set up in Cloudflare?"

node -e '
  const e = process.env;
  process.stdout.write(JSON.stringify({
    SUPABASE_URL: e.PREVIEW_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: e.PREVIEW_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: e.PREVIEW_SUPABASE_SECRET_KEY,
    STRIPE_SECRET_KEY: e.PREVIEW_STRIPE_SECRET_KEY,
    TIPPING_ENABLED: "true",
    PUBLIC_SITE_URL: e.SITE,
    PREVIEW_PASSWORD: e.PREVIEW_PASSWORD,
  }));' | SITE="$SITE" npx -y wrangler@4 secret bulk --name "$WORKER" >/dev/null
echo "preview: secrets stored"

# --- 6. Stripe test webhooks (first deploy only) ----------------------------------
if ! npx -y wrangler@4 secret list --name "$WORKER" 2>/dev/null | grep -q STRIPE_WEBHOOK_SECRET; then
  PREVIEW_SITE_URL="$SITE" node preview/stripe-webhooks.mjs | npx -y wrangler@4 secret bulk --name "$WORKER" >/dev/null
  echo "preview: Stripe test webhooks connected"
fi

echo
echo "Yooits preview is live at $SITE"
echo "Site password: the PREVIEW_PASSWORD you chose (any user name)."
echo "Test sign-ins (same password): owner@example.com (admin), alice@example.com, bob@example.com, casey@example.com"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "Yooits preview: $SITE" >> "$GITHUB_STEP_SUMMARY"
exit 0
