#!/usr/bin/env bash
# Vercel's build command for Yooits (Vercel Git integration). yooits.me is built
# from main; preview/yooits still builds so production can be switched back to it.
# The digital products pilot builds only as a Vercel Preview.
# Database migrations are managed separately from Vercel builds.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=${VERCEL_GIT_COMMIT_REF:-}
case "$BRANCH" in
  main|preview/yooits) ;;
  digital-products-pilot)
    if [ "${VERCEL_ENV:-}" != preview ]; then
      echo "vercel-build: the digital products pilot requires the Preview environment." >&2
      exit 1
    fi
    for name in SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL VITE_SUPABASE_URL; do
      if [[ "${!name:-}" == *zlunoczkptknsxviddiw.supabase.co* ]]; then
        echo "vercel-build: the digital products pilot requires a separate Preview database." >&2
        exit 1
      fi
    done
    export SEED_TEST_ACCOUNTS=false
    ;;
  *) echo "vercel-build: this branch is outside the deployment allowlist (this is '${BRANCH:-unknown}'); not building." >&2
     exit 1 ;;
esac
exec bash deploy/deploy.sh preview
