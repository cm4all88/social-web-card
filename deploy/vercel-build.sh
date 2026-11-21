#!/usr/bin/env bash
# Vercel's build command for the Yooits preview (Vercel Git integration).
# Set as the project's Build Command in Vercel, so only branches that have this
# file can build: main and the PR branches don't, and stop here.
# Migrates the preview database, loads the test accounts and builds; Vercel
# then deploys the result. Refuses the live database (see deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=${VERCEL_GIT_COMMIT_REF:-}
if [ "$BRANCH" != preview/yooits ]; then
  echo "vercel-build: only preview/yooits deploys to this project (this is '${BRANCH:-unknown}'); not building." >&2
  exit 1
fi
exec bash deploy/deploy.sh preview
