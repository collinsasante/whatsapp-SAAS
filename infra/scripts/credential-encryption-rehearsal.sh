#!/usr/bin/env bash
# Credential-encryption rehearsal on a DISPOSABLE database. Run it locally or against a restored COPY on staging; never against a live database.
#
#   REHEARSAL_DATABASE_URL=postgresql://user@127.0.0.1:5432/rehearsal_creds  infra/scripts/credential-encryption-rehearsal.sh
#
# What it does: checks the target is disposable, applies migrations to it, then runs apps/backend/src/common/crypto/credential-encryption-rehearsal.ts, which
# wipes that database, seeds all eight credential locations, and drives the real CLI through dry run, backup, apply, idempotency, wrong/missing/short key,
# key loss, restore, rollback, mixed data, an interrupted run and a compare-and-set conflict. The key it uses is generated in memory and discarded.
# It does not read CREDENTIALS_ENCRYPTION_KEY and it never prints a credential, a key or an id.
set -euo pipefail

url="${REHEARSAL_DATABASE_URL:-}"
[ -n "$url" ] || { echo "Set REHEARSAL_DATABASE_URL to a disposable database (its name must contain rehearsal, scratch, test or tmp)." >&2; exit 2; }
name="${url##*/}"; name="${name%%\?*}"
case "$name" in *rehearsal*|*scratch*|*test*|*tmp*) ;; *) echo "Refusing: database name '$name' is not marked disposable." >&2; exit 2;; esac
case "${url}" in *verzchat*|*prod*) echo "Refusing: the URL looks like a production database." >&2; exit 2;; esac
if [ "${NODE_ENV:-}" = "production" ] && [ "${REHEARSAL_ALLOW_PRODUCTION_NODE_ENV:-}" != "yes" ]; then
  echo "Refusing: NODE_ENV=production. If this is a staging container running a restored copy, set REHEARSAL_ALLOW_PRODUCTION_NODE_ENV=yes." >&2; exit 2
fi
for tool in node pg_dump pg_restore psql; do
  command -v "$tool" >/dev/null 2>&1 || [ -x "${PG_BIN_DIR:-/nonexistent}/$tool" ] || { echo "Missing required tool: $tool (set PG_BIN_DIR for the PostgreSQL client tools)." >&2; exit 2; }
done

cd "$(dirname "$0")/../../apps/backend"
echo "Applying migrations to the disposable database..."
DATABASE_URL="$url" npx prisma migrate deploy >/dev/null
echo "Running the rehearsal..."
REHEARSAL_DATABASE_URL="$url" npx ts-node src/common/crypto/credential-encryption-rehearsal.ts
