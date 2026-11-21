#!/usr/bin/env bash
# Vercel's build command for Yooits (Vercel Git integration). yooits.me is built
# from main; preview/yooits still builds so production can be switched back to it.
# Other branches stop here.
# Migrates the preview database, loads the test accounts and builds; Vercel
# then deploys the result. Refuses the live database (see deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=${VERCEL_GIT_COMMIT_REF:-}
# test/stripe: Stripe TEST-mode run on a Preview deployment (never production).
if [ "$BRANCH" = test/stripe ]; then
  [ "${VERCEL_ENV:-}" = preview ] || { echo "vercel-build: test/stripe only builds as a Preview deployment." >&2; exit 1; }
  export VERCEL_ENV_TARGET=preview
  exec bash deploy/deploy.sh preview
fi
case "$BRANCH" in
  main|preview/yooits) ;;
  *) echo "vercel-build: only main (or preview/yooits, for rollback) deploys to this project (this is '${BRANCH:-unknown}'); not building." >&2
     exit 1 ;;
esac
exec bash deploy/deploy.sh preview
