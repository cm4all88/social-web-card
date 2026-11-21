#!/usr/bin/env bash
# Deploys Yooits to one environment:   bash deploy/deploy.sh preview
#                                       bash deploy/deploy.sh production   (not in use yet)
#   1. safety checks: this environment's own database, never Lovable's,
#      Stripe test mode unless live payments are approved for it
#   2. optional backup, then database migrations (only ones not applied yet)
#   3. test accounts and content (preview only)
#   4. builds the site for this environment, without Lovable
#   5. deploys it to this environment's own Vercel project, with its settings
#   6. creates the Stripe webhooks the first time
#
# Non-secret settings: deploy/environments/<env>.env (committed).
# Secrets come from the GitHub environment of the same name, or for local
# runs from deploy/environments/<env>.secrets.local (never committed):
#   SUPABASE_URL  SUPABASE_PUBLISHABLE_KEY  SUPABASE_SECRET_KEY  SUPABASE_DB_URL
#   SITE_PASSWORD (preview)  STRIPE_SECRET_KEY (optional; tipping off without it)  VERCEL_TOKEN  (VERCEL_SCOPE: team accounts only)
# The names the Supabase-Vercel integration sets work too (SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, POSTGRES_URL_NON_POOLING ...). deploy/check-config.mjs
# checks every value before anything changes and repairs a badly pasted
# database connection string; nothing it prints holds a value.
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
if [ "${SEED_TEST_ACCOUNTS:-}" = true ]; then SEED_TEST_DATA=yes; fi
GATE=no
case "${PASSWORD_PROTECT:-no}" in
  yes) GATE=yes ;;
  if-set) sp=${SITE_PASSWORD:-}; if [ -n "${sp//[[:space:]]/}" ]; then GATE=yes; fi ;;
esac
export GATE
# On Vercel (Git integration, VERCEL=1) Vercel itself deploys what this script
# builds, so no Vercel token is needed, and the settings come from the Vercel project.
ON_VERCEL=no
if [ "${VERCEL:-}" = 1 ]; then ON_VERCEL=yes; fi
# Vercel builds never touch the database: migrations are applied to the
# project separately (Supabase connector or a local/GitHub run of this script),
# so a Vercel build needs only the public URL and keys, the secret key (test
# accounts are loaded through Supabase's API) and SITE_PASSWORD.
MIGRATE=yes
if [ "$ON_VERCEL" = yes ]; then MIGRATE=no; fi
say() { echo "deploy $ENV_NAME: $*"; }

clean() { # trims spaces, line breaks and surrounding quotes from the variable named $1
  local v=${!1:-}
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  if [ ${#v} -ge 2 ] && { [[ $v == \"*\" ]] || [[ $v == \'*\' ]]; }; then v=${v:1:${#v}-2}; fi
  printf -v "$1" '%s' "$v"
}
use_first() { # sets $1 from the first of its names (itself, then the others) that has a value
  local target=$1 n
  for n in "$@"; do
    clean "$n"
    if [ -n "${!n:-}" ]; then
      if [ "$n" != "$target" ]; then printf -v "$target" '%s' "${!n}"; say "using $n as $target"; fi
      export "$target"; return 0
    fi
  done
}
use_first SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL VITE_SUPABASE_URL
use_first SUPABASE_PUBLISHABLE_KEY SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY VITE_SUPABASE_PUBLISHABLE_KEY
# On Vercel the secret key is stored as SUPABASE_SERVICE_ROLE_KEY (the name the app reads).
use_first SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY
# The site and the tests ignore spaces or line breaks pasted around the password.
clean SITE_PASSWORD; export SITE_PASSWORD
while [ "${SUPABASE_URL%/}" != "$SUPABASE_URL" ]; do SUPABASE_URL=${SUPABASE_URL%/}; done

# Every missing setting is named at once, with the name to use where it's set.
shown() { if [ "$ON_VERCEL" = yes ] && [ "$1" = SUPABASE_SECRET_KEY ]; then echo SUPABASE_SERVICE_ROLE_KEY; else echo "$1"; fi; }
missing=()
for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY PROJECT_NAME BUILD_MODE; do
  [ -n "${!v:-}" ] || missing+=("$(shown "$v")")
done
if [ "$MIGRATE" = yes ] && [ -z "${SUPABASE_DB_URL:-}${POSTGRES_URL_NON_POOLING:-}${POSTGRES_URL:-}" ]; then missing+=(SUPABASE_DB_URL); fi
if { [ "$PASSWORD_PROTECT" = yes ] || [ "$SEED_TEST_DATA" = yes ]; } && [ -z "${SITE_PASSWORD:-}" ]; then missing+=(SITE_PASSWORD); fi
if [ "$ON_VERCEL" = no ] && [ "${DRY_RUN:-}" != 1 ] && [ -z "${VERCEL_TOKEN:-}" ]; then missing+=(VERCEL_TOKEN); fi
if [ ${#missing[@]} -gt 0 ]; then
  if [ "$ON_VERCEL" = yes ]; then
    target=Preview; [ "${VERCEL_ENV:-}" = production ] && target=Production
    fail "missing: ${missing[*]}. Add them in Vercel project ${PROJECT_NAME:-?} > Settings > Environment Variables, ticked for $target (this is a $target deployment), then redeploy."
  fi
  fail "missing: ${missing[*]} (see deploy/README.md)"
fi
if [ "$ON_VERCEL" = yes ]; then sha=${VERCEL_GIT_COMMIT_SHA:-unknown}; say "Vercel ${VERCEL_ENV:-?} deployment of ${VERCEL_GIT_COMMIT_REF:-?} at ${sha:0:7}"; fi
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "PROJECT_NAME should be lowercase letters, numbers and dashes"
export VERCEL_TOKEN VERCEL_SCOPE

# --- 1. Safety checks ---------------------------------------------------------------
# The database Lovable runs the live site on. No environment may use it: our
# deploys must never touch the Lovable-hosted production site.
LOVABLE_REF=oaeakgchijurkssjdxui
jwt_ref() { # prints the "ref" inside a legacy Supabase JWT key, if any
  local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  printf '%s' "$p" | base64 -d 2>/dev/null | sed -n 's/.*"ref":"\([^"]*\)".*/\1/p'
}
for v in SUPABASE_URL SUPABASE_DB_URL POSTGRES_URL_NON_POOLING POSTGRES_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  case "${!v:-}" in *"$LOVABLE_REF"*) fail "$v points at the Supabase project Lovable runs the live site on. Use this environment's own project.";; esac
done
for v in SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  [ "$(jwt_ref "${!v}")" != "$LOVABLE_REF" ] || fail "$v belongs to the Supabase project Lovable runs the live site on."
done
REF=$(printf '%s' "$SUPABASE_URL" | sed -n 's#^https://\([a-z0-9]*\)\.supabase\.co/*$#\1#p')
[ -n "$REF" ] || fail "SUPABASE_URL should look like https://<project>.supabase.co"
# Stripe is optional: without a key the site runs with tipping switched off.
STRIPE_MODE=test
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  STRIPE_MODE="off (no STRIPE_SECRET_KEY, tipping switched off)"
elif [[ "$STRIPE_SECRET_KEY" =~ ^(sk|rk)_live_ ]]; then
  [ "${ALLOW_STRIPE_LIVE:-no}" = yes ] || fail "STRIPE_SECRET_KEY is a LIVE key. Live payments aren't approved for $ENV_NAME."
  STRIPE_MODE=LIVE
else
  [[ "$STRIPE_SECRET_KEY" =~ ^(sk|rk)_test_ ]] || fail "STRIPE_SECRET_KEY doesn't look like a Stripe secret key."
fi
if [ "$GATE" = yes ] && [ ${#SITE_PASSWORD} -lt 12 ]; then fail "SITE_PASSWORD must be at least 12 characters."; fi
if [ "$SEED_TEST_DATA" = yes ] && [ "$ENV_NAME" != preview ]; then fail "test data is only allowed in the preview."; fi
unset STRIPE_LIVE_MODE_APPROVED
say "Supabase project $REF, Vercel project $PROJECT_NAME, Stripe: $STRIPE_MODE"
if [ "$GATE" = yes ]; then say "site password: on"; else say "site password: off (the site is public)"; fi
if [ "$SEED_TEST_DATA" = yes ]; then say "test accounts: loading"; else say "test accounts: not loaded (set SEED_TEST_ACCOUNTS=true to load them)"; fi

# Checks the keys against Supabase and finds a database connection that works
# (repairing how the string was pasted); stops with what to fix otherwise.
DB_FILE=$(mktemp); chmod 600 "$DB_FILE"
CHECK=(--db-out "$DB_FILE")
if [ "$MIGRATE" = no ]; then
  CHECK=(--no-db); [ "${DRY_RUN:-}" = 1 ] && CHECK+=(--offline)
elif [ "${DRY_RUN:-}" = 1 ]; then
  CHECK+=(--offline)
else
  PG_MODULE_DIR=$(mktemp -d); export PG_MODULE_DIR
  npm install --prefix "$PG_MODULE_DIR" --no-audit --no-fund --no-package-lock --loglevel=error pg@8.13.1 >/dev/null \
    || fail "couldn't download the database checker (npm package pg)"
fi
node deploy/check-config.mjs "${CHECK[@]}" || { rm -f "$DB_FILE"; exit 1; }
if [ "$MIGRATE" = yes ]; then SUPABASE_DB_URL=$(cat "$DB_FILE"); export SUPABASE_DB_URL; fi
rm -f "$DB_FILE"

# --- 2. Backup, then database migrations ------------------------------------------------
# (DRY_RUN=1 checks the settings and builds, but changes nothing anywhere.)
if [ "$MIGRATE" = no ]; then
  say "database migrations: not run in this build (apply supabase/migrations to project $REF first)"
elif [ "${DRY_RUN:-}" != 1 ]; then
  if [ "${BACKUP_BEFORE_MIGRATE:-no}" = yes ]; then bash deploy/backup.sh "$ENV_NAME"; fi
  npx -y supabase@2 db push --db-url "$SUPABASE_DB_URL" --yes
fi

# --- 3. Test accounts and content (preview only) ------------------------------------------
if [ "$SEED_TEST_DATA" = yes ] && [ "${DRY_RUN:-}" != 1 ]; then
  node deploy/seed.mjs || fail "loading the test accounts failed (above). If it names a missing table, the migrations in supabase/migrations aren't applied to project $REF yet."
fi

# --- 4. Build for this environment, without Lovable ----------------------------------------
cat > ".env.$BUILD_MODE.local" <<ENV
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID=$REF
ENV
trap 'rm -f ".env.$BUILD_MODE.local"' EXIT
rm -rf dist .wrangler .vercel/output
NITRO_PRESET=vercel npx vite build --config vite.config.standalone.ts --mode "$BUILD_MODE"
OUTPUT=.vercel/output
[ -f "$OUTPUT/config.json" ] || fail "the build didn't produce $OUTPUT"
if grep -rq "$LOVABLE_REF" "$OUTPUT"; then fail "the build still contains the Lovable database's id; not deploying"; fi
grep -rq "$REF" "$OUTPUT/static" || fail "the build doesn't use this environment's database; not deploying"
if [ "${DRY_RUN:-}" = 1 ]; then say "dry run: built and checked, not deployed"; exit 0; fi
if [ "$ON_VERCEL" = yes ]; then
  trap - EXIT; rm -f ".env.$BUILD_MODE.local"
  say "built and checked; Vercel deploys it now"
  exit 0
fi

# --- 5. Deploy to this environment's Vercel project --------------------------------------
# Each environment is its own Vercel project (PROJECT_NAME), so preview and
# production never share settings. The project is created on the first run.
vc() { npx -y vercel@66.6.0 --token "$VERCEL_TOKEN" ${VERCEL_SCOPE:+--scope "$VERCEL_SCOPE"} "$@"; }
if ! vc project inspect "$PROJECT_NAME" >/dev/null 2>&1; then
  vc project create "$PROJECT_NAME" >/dev/null
  say "created Vercel project $PROJECT_NAME"
fi
vc link --yes --project "$PROJECT_NAME" >/dev/null
[ -f "$OUTPUT/config.json" ] || fail "linking the Vercel project removed the build; not deploying"

if [ -n "${CUSTOM_DOMAIN:-}" ]; then SITE="https://$CUSTOM_DOMAIN"; else SITE="https://$PROJECT_NAME.vercel.app"; fi
settings() { # prints this environment's settings as JSON for deploy/vercel-env.mjs
  SITE="$SITE" node -e '
    const e = process.env;
    const s = {
      SUPABASE_URL: e.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: e.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SECRET_KEY,
      TIPPING_ENABLED: e.STRIPE_SECRET_KEY ? "true" : "false",
      PUBLIC_SITE_URL: e.SITE,
    };
    if (e.STRIPE_SECRET_KEY) s.STRIPE_SECRET_KEY = e.STRIPE_SECRET_KEY;
    if (e.GATE === "yes") s.SITE_PASSWORD = e.SITE_PASSWORD;
    process.stdout.write(JSON.stringify(s));'
}
settings | node deploy/vercel-env.mjs
if [ "$GATE" != yes ]; then
  vc env remove SITE_PASSWORD --environment production --yes >/dev/null 2>&1 || true
fi

deploy_once() { # deploys the build to production on this project; sets DEPLOYED to its address
  local out
  out=$(vc deploy --prebuilt --prod --yes --json)
  DEPLOYED=$(printf '%s' "$out" | node deploy/vercel-site.mjs)
  if [ -z "$DEPLOYED" ]; then
    DEPLOYED="$PROJECT_NAME.vercel.app"
    say "warning: Vercel's reply didn't list the site's address; assuming $DEPLOYED (check the project's Domains in Vercel)"
  fi
}
deploy_once
REDEPLOY=no
if [ -z "${CUSTOM_DOMAIN:-}" ] && [ "https://$DEPLOYED" != "$SITE" ]; then
  SITE="https://$DEPLOYED"   # the plain name was taken; use the address Vercel gave
  settings | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({PUBLIC_SITE_URL:JSON.parse(s).PUBLIC_SITE_URL})))' \
    | node deploy/vercel-env.mjs
  REDEPLOY=yes
fi
say "settings stored"

# --- 6. Stripe webhooks (first deploy only) ------------------------------------------------------
if [ -n "${STRIPE_SECRET_KEY:-}" ] && ! vc env ls 2>/dev/null | grep -q STRIPE_WEBHOOK_SECRET; then
  SITE_URL="$SITE" node deploy/stripe-webhooks.mjs | node deploy/vercel-env.mjs
  say "Stripe test webhooks connected"
  REDEPLOY=yes
fi
# Settings only reach a deployment made after they were stored.
if [ "$REDEPLOY" = yes ]; then deploy_once; fi

echo
echo "Yooits $ENV_NAME is live at $SITE"
if [ "$GATE" = yes ]; then echo "Site password: the SITE_PASSWORD you chose (any user name)."; fi
if [ "$SEED_TEST_DATA" = yes ]; then
  echo "Test sign-ins (same password): owner@example.com (admin), alice@example.com, bob@example.com, casey@example.com"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "Yooits $ENV_NAME: $SITE" >> "$GITHUB_STEP_SUMMARY"; fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "site=$SITE" >> "$GITHUB_OUTPUT"; fi
exit 0
