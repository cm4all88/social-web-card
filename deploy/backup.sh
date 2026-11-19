#!/usr/bin/env bash
# Backs up one environment: database (roles, schema, data including user
# accounts) plus every uploaded file, packed into one ENCRYPTED file:
#   bash deploy/backup.sh preview
#   -> backups/yooits-preview-<UTC time>.tar.gz.gpg
# Restore steps: deploy/MIGRATION.md ("Restoring a backup").
#
# Needs the environment's SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
# and BACKUP_PASSPHRASE (from GitHub or deploy/environments/<env>.secrets.local).
# The backup holds user accounts, so it is never written unencrypted outside
# a temporary folder that is deleted at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME=${1:-}
fail() { echo "backup ${ENV_NAME:-?}: $*" >&2; exit 1; }
[[ "$ENV_NAME" =~ ^[a-z][a-z0-9-]*$ ]] && [ -f "deploy/environments/$ENV_NAME.env" ] \
  || fail "usage: deploy/backup.sh <environment>"
set -a
. "deploy/environments/$ENV_NAME.env"
[ -f "deploy/environments/$ENV_NAME.secrets.local" ] && . "deploy/environments/$ENV_NAME.secrets.local"
set +a
for v in SUPABASE_DB_URL SUPABASE_URL SUPABASE_SECRET_KEY BACKUP_PASSPHRASE; do
  [ -n "${!v:-}" ] || fail "$v is not set (see deploy/README.md)"
done
[ ${#BACKUP_PASSPHRASE} -ge 16 ] || fail "BACKUP_PASSPHRASE must be at least 16 characters."
command -v gpg >/dev/null || fail "gpg is needed to encrypt the backup."

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="yooits-$ENV_NAME-$STAMP"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$NAME" backups

# Uses the Supabase CLI's own dump (it runs pg_dump in Docker, matching the
# server's Postgres version). Without Docker it runs the same pg_dump script
# with the local pg_dump, which must be at least the server's version.
dump() { # dump <file> <supabase db dump flags...>
  local file=$1; shift
  if docker info >/dev/null 2>&1; then
    npx -y supabase@2 db dump --db-url "$SUPABASE_DB_URL" -f "$file" "$@"
  else
    npx -y supabase@2 db dump --db-url "$SUPABASE_DB_URL" --dry-run "$@" 2>/dev/null | bash > "$file"
  fi
}
echo "backup $ENV_NAME: dumping the database"
dump "$WORK/$NAME/roles.sql" --role-only
dump "$WORK/$NAME/schema.sql"
dump "$WORK/$NAME/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
dump "$WORK/$NAME/history_schema.sql" --schema supabase_migrations
dump "$WORK/$NAME/history_data.sql" --use-copy --data-only --schema supabase_migrations
grep -q "auth" "$WORK/$NAME/data.sql" || fail "the data dump looks empty; not saving it"

echo "backup $ENV_NAME: downloading uploaded files"
node deploy/storage-backup.mjs "$WORK/$NAME/storage"

tar -czf "$WORK/$NAME.tar.gz" -C "$WORK" "$NAME"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 -o "backups/$NAME.tar.gz.gpg" "$WORK/$NAME.tar.gz"
echo "backup $ENV_NAME: saved backups/$NAME.tar.gz.gpg ($(du -h "backups/$NAME.tar.gz.gpg" | cut -f1))"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "file=backups/$NAME.tar.gz.gpg" >> "$GITHUB_OUTPUT"; fi
