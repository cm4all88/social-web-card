#!/usr/bin/env bash
# Brings preview/yooits up to date with the latest commits on every branch in
# deploy/branches.txt, runs the tests, and pushes. The push redeploys the
# preview through GitHub Actions (once the preview secrets are in). Never touches main.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(git branch --show-current)" = "preview/yooits" ] || { echo "Switch to preview/yooits first." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash local changes first." >&2; exit 1; }

git fetch -q origin
git merge -q --ff-only origin/preview/yooits 2>/dev/null || true
grep -vE '^\s*(#|$)' deploy/branches.txt | while read -r b; do
  echo "Merging $b"
  if ! git merge --no-edit -q "origin/$b"; then
    conflicts=$(git diff --name-only --diff-filter=U)
    if [ "$conflicts" = "src/routeTree.gen.ts" ]; then
      # Generated file: take either side, then rebuild it below.
      git checkout --theirs src/routeTree.gen.ts && git add src/routeTree.gen.ts
      git commit --no-edit -q
    else
      echo "Real conflicts merging $b:" >&2; echo "$conflicts" >&2
      git merge --abort; exit 1
    fi
  fi
done

npx vite build >/dev/null           # regenerates src/routeTree.gen.ts
rm -rf dist .wrangler
if ! git diff --quiet -- src/routeTree.gen.ts; then
  git commit -q -m "Preview: regenerate route tree" -- src/routeTree.gen.ts
fi
npx tsc --noEmit -p .
npx vitest run
git push -q origin preview/yooits
echo "preview/yooits updated and pushed."
