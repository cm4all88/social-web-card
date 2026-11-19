#!/usr/bin/env bash
# Deploys Yooits to one environment:   bash deploy/deploy.sh preview
#                                       bash deploy/deploy.sh production   (not in use yet)
#   1. safety checks: this environment's own database, never Lovable's,
#      Stripe test mode unless live payments are approved for it
#   2. optional backup, then database migrations (only ones not applied yet)
#   3. test accounts and content (preview only)
#   4. builds the site for this environment, without Lovable
#   5. deploys it as a Cloudflare Worker and stores its secrets
#   6. creates the Stripe webhooks the first time
#
# Non-secret settings: deploy/environments/<env>.env (committed).
# Secrets come from the GitHub environment of the same name, or for local
# runs from deploy/environments/<env>.secrets.local (never committed):
#   SUPABASE_URL  SUPABASE_PUBLISHABLE_KEY  SUPABASE_SECRET_KEY  SUPABASE_DB_URL
#   STRIPE_SECRET_KEY  SITE_PASSWORD (preview)  CLOUDFLARE_API_TOKEN  CLOUDFLARE_ACCOUNT_ID
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME=${1:-}
fail() { echo "deploy ${ENV_NAME:-?}: $*" >&2; exit 1; }
[[ "$ENV_NAME" =~ ^[a-z][a-z0-9-]*$ ]] && [ -f "deploy/environments/$ENV_NAME.env" ] \
  || fail "usage: deploy/deploy.sh <environment>, where deploy/environments/<environment>.env exists"
set -a
. "deploy/environments/$ENV_NAME.env"
[ -f "deploy/environments/$ENV_NAME.secrets.local" ] && . "deploy/environments/$ENV_NAME.secrets.local"
set +a
export YOOITS_ENV=$ENV_NAME
say() { echo "deploy $ENV_NAME: $*"; }
need() { [ -n "${!1:-}" ] || fail "$1 is not set (see deploy/README.md)"; }

for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY SUPABASE_DB_URL STRIPE_SECRET_KEY \
         CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID WORKER_NAME BUILD_MODE; do need "$v"; done
if [ "$PASSWORD_PROTECT" = yes ]; then need SITE_PASSWORD; fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# --- 1. Safety checks ---------------------------------------------------------------
# The database Lovable runs the live site on. No environment may use it: our
# deploys must never touch the Lovable-hosted production site.
LOVABLE_REF=oaeakgchijurkssjdxui
jwt_ref() { # prints the "ref" inside a legacy Supabase JWT key, if any
  local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  printf '%s' "$p" | base64 -d 2>/dev/null | sed -n 's/.*"ref":"\([^"]*\)".*/\1/p'
}
for v in SUPABASE_URL SUPABASE_DB_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  case "${!v}" in *"$LOVABLE_REF"*) fail "$v points at the Supabase project Lovable runs the live site on. Use this environment's own project.";; esac
done
for v in SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  [ "$(jwt_ref "${!v}")" != "$LOVABLE_REF" ] || fail "$v belongs to the Supabase project Lovable runs the live site on."
done
REF=$(printf '%s' "$SUPABASE_URL" | sed -n 's#^https://\([a-z0-9]*\)\.supabase\.co/*$#\1#p')
[ -n "$REF" ] || fail "SUPABASE_URL should look like https://<project>.supabase.co"
case "$SUPABASE_DB_URL" in *"$REF"*) ;; *) fail "SUPABASE_DB_URL isn't for the same project as SUPABASE_URL";; esac
STRIPE_MODE=test
if [[ "$STRIPE_SECRET_KEY" =~ ^(sk|rk)_live_ ]]; then
  [ "${ALLOW_STRIPE_LIVE:-no}" = yes ] || fail "STRIPE_SECRET_KEY is a LIVE key. Live payments aren't approved for $ENV_NAME."
  STRIPE_MODE=LIVE
else
  [[ "$STRIPE_SECRET_KEY" =~ ^(sk|rk)_test_ ]] || fail "STRIPE_SECRET_KEY doesn't look like a Stripe secret key."
fi
if [ "$PASSWORD_PROTECT" = yes ] && [ ${#SITE_PASSWORD} -lt 12 ]; then fail "SITE_PASSWORD must be at least 12 characters."; fi
if [ "$SEED_TEST_DATA" = yes ] && [ "$ENV_NAME" != preview ]; then fail "test data is only allowed in the preview."; fi
unset STRIPE_LIVE_MODE_APPROVED
say "Supabase project $REF, Worker $WORKER_NAME, Stripe $STRIPE_MODE mode"

# --- 2. Backup, then database migrations ------------------------------------------------
# (DRY_RUN=1 checks the settings and builds, but changes nothing anywhere.)
if [ "${DRY_RUN:-}" != 1 ]; then
  if [ "${BACKUP_BEFORE_MIGRATE:-no}" = yes ]; then bash deploy/backup.sh "$ENV_NAME"; fi
  npx -y supabase@2 db push --db-url "$SUPABASE_DB_URL" --yes
fi

# --- 3. Test accounts and content (preview only) ------------------------------------------
if [ "$SEED_TEST_DATA" = yes ] && [ "${DRY_RUN:-}" != 1 ]; then node deploy/seed.mjs; fi

# --- 4. Build for this environment, without Lovable ----------------------------------------
cat > ".env.$BUILD_MODE.local" <<ENV
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID=$REF
ENV
trap 'rm -f ".env.$BUILD_MODE.local"' EXIT
rm -rf dist .wrangler
npx vite build --config vite.config.standalone.ts --mode "$BUILD_MODE"
if grep -rq "$LOVABLE_REF" dist; then fail "the build still contains the Lovable database's id; not deploying"; fi
grep -rq "$REF" dist/client || fail "the build doesn't use this environment's database; not deploying"
[ -f dist/server/wrangler.json ] || fail "the build didn't produce dist/server/wrangler.json"
if [ "${DRY_RUN:-}" = 1 ]; then say "dry run: built and checked, not deployed"; exit 0; fi

# --- 5. Deploy and store secrets ---------------------------------------------------------------
OUT=$(npx -y wrangler@4 deploy --config dist/server/wrangler.json --name "$WORKER_NAME" 2>&1 | tee /dev/stderr)
if [ -n "${CUSTOM_DOMAIN:-}" ]; then
  SITE="https://$CUSTOM_DOMAIN"
else
  SITE=$(printf '%s' "$OUT" | grep -oE "https://$WORKER_NAME\.[a-z0-9-]+\.workers\.dev" | head -1)
  [ -n "$SITE" ] || fail "deployed, but couldn't find the workers.dev address in Wrangler's output. Is a workers.dev subdomain set up in Cloudflare?"
fi

SITE="$SITE" node -e '
  const e = process.env;
  const s = {
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: e.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SECRET_KEY,
    STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY,
    TIPPING_ENABLED: "true",
    PUBLIC_SITE_URL: e.SITE,
  };
  if (e.PASSWORD_PROTECT === "yes") s.SITE_PASSWORD = e.SITE_PASSWORD;
  process.stdout.write(JSON.stringify(s));' | npx -y wrangler@4 secret bulk --name "$WORKER_NAME" >/dev/null
SECRETS=$(npx -y wrangler@4 secret list --name "$WORKER_NAME" 2>/dev/null || true)
if [ "$PASSWORD_PROTECT" != yes ] && printf '%s' "$SECRETS" | grep -q SITE_PASSWORD; then
  npx -y wrangler@4 secret delete SITE_PASSWORD --name "$WORKER_NAME" >/dev/null
fi
say "secrets stored"

# --- 6. Stripe webhooks (first deploy only) ------------------------------------------------------
if ! printf '%s' "$SECRETS" | grep -q STRIPE_WEBHOOK_SECRET; then
  SITE_URL="$SITE" node deploy/stripe-webhooks.mjs | npx -y wrangler@4 secret bulk --name "$WORKER_NAME" >/dev/null
  say "Stripe test webhooks connected"
fi

echo
echo "Yooits $ENV_NAME is live at $SITE"
if [ "$PASSWORD_PROTECT" = yes ]; then echo "Site password: the SITE_PASSWORD you chose (any user name)."; fi
if [ "$SEED_TEST_DATA" = yes ]; then
  echo "Test sign-ins (same password): owner@example.com (admin), alice@example.com, bob@example.com, casey@example.com"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "Yooits $ENV_NAME: $SITE" >> "$GITHUB_STEP_SUMMARY"; fi
exit 0
