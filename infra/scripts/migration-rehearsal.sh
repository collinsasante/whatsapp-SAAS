#!/usr/bin/env bash
# Migration rehearsal on DISPOSABLE databases. Proves, for the six pending migrations:
#   1. a blank database built from the whole history ends at the same schema as an incremental upgrade of a database that was at the previous state;
#   2. existing data survives the upgrade untouched;
#   3. every migration is idempotent (applying its SQL a second time changes nothing and does not fail);
#   4. every rollback script returns the schema EXACTLY to the previous state, leaving existing data untouched, and re-applying brings the new schema back identically.
# Never touches anything but the two databases it creates (names contain "rehearsal") and drops them at the end.
#   MIGREHEARSAL_ADMIN_URL=postgresql://user@127.0.0.1:5432   [PG_BIN_DIR=/path/to/pg/bin]  infra/scripts/migration-rehearsal.sh
set -euo pipefail
ADMIN=${MIGREHEARSAL_ADMIN_URL:-}; [ -n "$ADMIN" ] || { echo "Set MIGREHEARSAL_ADMIN_URL (server URL without a database name)." >&2; exit 2; }
case "$ADMIN" in *verzchat*|*prod*) echo "Refusing: looks like production." >&2; exit 2;; esac
PGB=${PG_BIN_DIR:+$PG_BIN_DIR/}
ROOT=$(cd "$(dirname "$0")/../.." && pwd); BE=$ROOT/apps/backend; MIG=$BE/prisma/migrations; RB=$BE/prisma/rollbacks
NEW=(20261104120000_channel_history_sync 20261105120000_ai_conversation_leases 20261106120000_ai_daily_credit_cap 20261107120000_tiktok_publications 20261108120000_ai_cap_alerts 20261109120000_message_enrichments)
BLANK=migrehearsal_blank; INCR=migrehearsal_incr; T=$(mktemp -d); PASS=0; FAIL=0
trap 'rm -rf "$T"; "${PGB}psql" "$ADMIN/postgres" -qc "DROP DATABASE IF EXISTS $BLANK" -c "DROP DATABASE IF EXISTS $INCR" >/dev/null 2>&1 || true' EXIT
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }; check() { local l=$1; shift; if "$@" >/dev/null; then ok "$l"; else bad "$l"; fi; }
same() { if diff -q "$1" "$2" >/dev/null; then return 0; fi; diff "$1" "$2" | head -${DIFF_LINES:-14} >&2; return 1; }
sql() { "${PGB}psql" "$ADMIN/$1" -v ON_ERROR_STOP=1 -qAt -c "$2"; }
file() { "${PGB}psql" "$ADMIN/$1" -v ON_ERROR_STOP=1 -q -f "$2" >/dev/null; }
schema() { "${PGB}pg_dump" --schema-only --no-owner --no-privileges "$ADMIN/$1" | grep -v '^--' | grep -v '^$' | grep -v 'SET \|SELECT pg_catalog' | grep -v '^\\\(un\)\{0,1\}restrict '; }  # pg_dump 17 adds a random \restrict nonce to every dump
for d in $BLANK $INCR; do sql postgres "DROP DATABASE IF EXISTS $d"; sql postgres "CREATE DATABASE $d"; done

echo "== 1. blank database from the whole history"
( cd "$BE" && DATABASE_URL="$ADMIN/$BLANK" npx prisma migrate deploy >/dev/null 2>&1 ) && ok "prisma migrate deploy on a blank database succeeds" || bad "blank deploy"
TOTAL=$(ls "$MIG" | grep -c '^[0-9]')
check "all $TOTAL migrations are recorded as finished" bash -c "[ \"\$(\"${PGB}psql\" '$ADMIN/$BLANK' -qAt -c 'select count(*) from _prisma_migrations where finished_at is not null')\" = $TOTAL ]"

echo "== 2. incremental: a database at the PREVIOUS state, with data, upgraded"
mkdir -p "$T/prisma/migrations"; cp "$BE/prisma/schema.prisma" "$T/prisma/"; cp "$MIG/migration_lock.toml" "$T/prisma/migrations/"
for m in $(ls "$MIG" | grep '^[0-9]'); do skip=0; for n in "${NEW[@]}"; do [ "$m" = "$n" ] && skip=1; done; [ $skip = 0 ] && cp -R "$MIG/$m" "$T/prisma/migrations/"; done
( cd "$BE" && DATABASE_URL="$ADMIN/$INCR" npx prisma migrate deploy --schema "$T/prisma/schema.prisma" >/dev/null 2>&1 ) && ok "the previous state ($((TOTAL - ${#NEW[@]})) migrations) applies" || bad "previous-state deploy"
sql $INCR "INSERT INTO tenants (id,name,webhook_verify_token,ai_credits,updated_at) VALUES ('00000000-0000-4000-8000-0000000000a1','Keep','v',777,now())"
sql $INCR "INSERT INTO tenant_settings (id,tenant_id,timezone,business_name,updated_at) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000a1','Africa/Accra','Keep Ltd',now())"
sql $INCR "INSERT INTO channels (id,tenant_id,type,name,credentials,metadata,updated_at) VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','TELEGRAM','bot','{\"botToken\":\"x\"}','{}',now())"
DATA() { sql $INCR "select (select ai_credits from tenants where id='00000000-0000-4000-8000-0000000000a1')||'|'||(select business_name from tenant_settings)||'|'||(select credentials::text from channels)"; }
BEFORE_DATA=$(DATA); schema $INCR > "$T/previous.sql"
( cd "$BE" && DATABASE_URL="$ADMIN/$INCR" npx prisma migrate deploy >/dev/null 2>&1 ) && ok "the real deploy applies the ${#NEW[@]} pending migrations" || bad "incremental deploy"
check "existing data is byte-identical after the upgrade" test "$(DATA)" = "$BEFORE_DATA"
check "the new settings columns default OFF/NULL for the existing workspace" test "$(sql $INCR "select voice_transcription_enabled::text||image_understanding_enabled::text||coalesce(ai_daily_credit_cap::text,'null')||coalesce(ai_cap_warn_percent::text,'null') from tenant_settings")" = "falsefalsenullnull"
schema $INCR > "$T/upgraded.sql"; schema $BLANK > "$T/blank.sql"
check "INCREMENTAL == BLANK: the upgraded schema equals the one built from scratch" same "$T/upgraded.sql" "$T/blank.sql"

echo "== 3. idempotency: each migration's SQL applied again"
for m in "${NEW[@]}"; do check "$m applies twice without error or change" bash -c "\"${PGB}psql\" '$ADMIN/$INCR' -v ON_ERROR_STOP=1 -q -f '$MIG/$m/migration.sql' >/dev/null"; done
schema $INCR > "$T/idem.sql"; check "the schema is unchanged by the repeats" same "$T/idem.sql" "$T/upgraded.sql"
check "existing data unchanged by the repeats" test "$(DATA)" = "$BEFORE_DATA"

echo "== 4. rollback in reverse order, then forward again"
for ((i=${#NEW[@]}-1; i>=0; i--)); do m=${NEW[$i]}; check "rollback of $m runs" file $INCR "$RB/$m.down.sql"; done
schema $INCR > "$T/rolled.sql"
check "after all rollbacks the schema EQUALS the previous state exactly" same "$T/rolled.sql" "$T/previous.sql"
check "existing data is untouched by the rollbacks" test "$(DATA)" = "$BEFORE_DATA"
check "rolling back twice is harmless" bash -c "for ((i=${#NEW[@]}-1; i>=0; i--)); do m=(${NEW[*]}); \"${PGB}psql\" '$ADMIN/$INCR' -v ON_ERROR_STOP=1 -q -f '$RB/'\${m[\$i]}.down.sql >/dev/null || exit 1; done"
for m in "${NEW[@]}"; do file $INCR "$MIG/$m/migration.sql"; done
schema $INCR > "$T/reapplied.sql"
check "re-applying forward restores the new schema exactly" same "$T/reapplied.sql" "$T/blank.sql"
check "existing data still untouched" test "$(DATA)" = "$BEFORE_DATA"

echo; echo "MIGRATION REHEARSAL: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
