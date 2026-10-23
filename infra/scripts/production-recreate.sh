#!/usr/bin/env bash
# PRODUCTION. Recreates production containers (compose project verzchat-prod) from infra/.env so that a changed setting,
# for example a new Meta app or API key, takes effect, and then checks that WhatsApp and Messenger webhooks are still being
# accepted. Prints names, fingerprints and counts, never secret values. It only ever touches the wa_* production containers.
#
#   read only:  bash production-recreate.sh check [service...]
#   apply:      CONFIRM_PRODUCTION=yes bash production-recreate.sh apply [service...]      (default service: backend)
#   webhooks:   bash production-recreate.sh webhooks [minutes]                              (read only, default 10 minutes)
#
# Why this exists: a container only reads its settings when it is created, and a plain restart or code hot-swap does not
# apply a new setting. Recreating production once switched on a value meant for staging, and about an hour of incoming
# WhatsApp webhooks were rejected before anyone noticed. This script refuses to recreate when a setting is unsafe, keeps
# the running (hot-swapped) backend code, and measures webhook responses right after the restart so a problem is seen at once.
set -u
MODE=${1:-}; shift || true
fail() { echo "ABORT: $*"; exit 1; }
warn() { echo "WARN:  $*"; }
case "$MODE" in check|apply|webhooks) ;; *) fail "usage: production-recreate.sh check|apply [service...]  |  webhooks [minutes]";; esac

INFRA=${INFRA_DIR:-/root/whatsapp-platform/infra}
PFILE=${PROD_ENV_FILE:-$INFRA/.env}
SFILE=${STAGING_ENV_FILE:-$INFRA/.env.staging}
COMPOSE_FILE=$INFRA/docker-compose.yml
HEALTH_URL=${PROD_HEALTH_URL:-https://verzchat.com/api/v1/health}
C="docker compose --env-file $PFILE -f $COMPOSE_FILE"

val() { grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/" | tr -d '\r\n'; }
fp() { printf %s "$1" | sha256sum | cut -c1-8; }

# Response codes of webhook calls received since $1 (a time Docker understands), and whether any were rejected.
# Prints a table, returns 0 when nothing was rejected, 1 when some were, 2 when no webhook arrived at all.
webhook_report() {
  local since=$1 lines total bad
  lines=$(docker logs --since "$since" wa_nginx 2>&1 | grep "POST /api/v1/webhook/" | awk '{print $7, $9}' | sed -E 's#/webhook/(whatsapp)/[^ ]+#/webhook/\1/<tenant>#')
  total=$(printf '%s' "$lines" | grep -c . || true)
  if [ "$total" -eq 0 ]; then echo "no webhook requests seen since $since"; return 2; fi
  printf '%s\n' "$lines" | sort | uniq -c | sort -rn | head -8
  bad=$(printf '%s\n' "$lines" | awk '$2 >= 400' | wc -l | tr -d ' ')
  [ "$bad" -eq 0 ] && return 0
  echo "REJECTED webhook requests: $bad of $total"; return 1
}

if [ "$MODE" = webhooks ]; then
  M=${1:-10}
  echo "== Webhook responses, last $M minutes (200 is good; 400 means rejected)"
  webhook_report "${M}m"; rc=$?
  [ $rc -eq 0 ] && echo "all webhook requests were accepted."
  exit $rc
fi

SERVICES=${*:-backend}
echo "== 1. Files"
[ -f "$PFILE" ] || fail "$PFILE does not exist."
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found."
[ "$PFILE" != "$SFILE" ] || fail "the production and staging settings files are the same file."

echo "== 2. This really is production"
for s in backend postgres nginx; do
  docker inspect "wa_$s" >/dev/null 2>&1 || fail "container wa_$s was not found."
done
DB=$(docker exec wa_backend printenv DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#')
case "$DB" in *_staging) fail "the running database '$DB' is a staging database.";; esac
NEWDB=$($C config 2>/dev/null | grep -m1 "DATABASE_URL" | sed -E 's#.*/([^/?"]+).*#\1#')
[ "$NEWDB" = "$DB" ] || fail "with $PFILE the database would change from '$DB' to '$NEWDB'."
echo "production database: $DB (unchanged)"

echo "== 3. Settings that must be safe in production"
for k in JWT_SECRET JWT_REFRESH_SECRET; do
  v=$(val "$PFILE" "$k")
  [ -n "$v" ] || fail "$k is empty in $PFILE."
  case "$v" in changeme|changeme-refresh) fail "$k is still the placeholder default.";; esac
  s=$(val "$SFILE" "$k")
  [ -z "$s" ] || [ "$s" != "$v" ] || fail "$k is identical in production and staging: a login token from one would work on the other."
done
v=$(val "$PFILE" WHATSAPP_APP_SECRET)
[ -z "$v" ] || [ "${ALLOW_WHATSAPP_APP_SECRET:-}" = "yes" ] || \
  fail "WHATSAPP_APP_SECRET is set in $PFILE. Your WhatsApp webhooks come from several different Meta apps, so one global secret rejects most of them. Leave it empty (set ALLOW_WHATSAPP_APP_SECRET=yes only if you know every sender uses that one app)."
s=$(val "$SFILE" PLATFORM_ADMIN_SETUP_SECRET); p=$(val "$PFILE" PLATFORM_ADMIN_SETUP_SECRET)
[ -z "$s" ] || [ -z "$p" ] || [ "$s" != "$p" ] || fail "PLATFORM_ADMIN_SETUP_SECRET is identical in production and staging."
for k in FACEBOOK_APP_SECRET DEEPSEEK_API_KEY RESEND_API_KEY SMTP_PASS CREDENTIALS_ENCRYPTION_KEY; do
  p=$(val "$PFILE" "$k"); s=$(val "$SFILE" "$k")
  [ -z "$p" ] || [ "$s" != "$p" ] || warn "$k is the same in production and staging (fingerprint $(fp "$p"))."
done
NOW_APP=$(docker exec wa_backend printenv FACEBOOK_APP_ID); NEW_APP=$(val "$PFILE" FACEBOOK_APP_ID)
if [ "$NOW_APP" != "$NEW_APP" ]; then echo "NOTE:  the Meta app will change: running=$NOW_APP  new=$NEW_APP"; else echo "Meta app unchanged: $NOW_APP"; fi

echo "== 4. No unset settings"
MISSING=$($C config 2>&1 >/dev/null | grep -i "is not set" | sed -E 's/.*The \\*"([A-Za-z0-9_]+)\\*" variable.*/\1/' | sort -u | tr '\n' ' ')
[ -z "$MISSING" ] || fail "these settings are not defined in $PFILE: $MISSING"

echo "all checks passed."
if [ "$MODE" = check ]; then echo "check only: nothing was changed."; exit 0; fi
[ "${CONFIRM_PRODUCTION:-}" = "yes" ] || fail "this changes PRODUCTION. Re-run with CONFIRM_PRODUCTION=yes."

echo "== 5. Snapshot, then recreate: $SERVICES"
SNAP=${SNAPSHOT_DIR:-/root/production-env-snapshots}; mkdir -p "$SNAP" && chmod 700 "$SNAP" || fail "cannot create $SNAP"
TS=$(date +%Y%m%d-%H%M%S)
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_backend | sort > "$SNAP/backend-env-$TS.before" && chmod 600 "$SNAP/backend-env-$TS.before"
if echo " $SERVICES " | grep -q " backend "; then
  IMG=$(docker inspect -f '{{.Config.Image}}' wa_backend) || fail "inspect backend"
  docker tag "$IMG" "wa-production-backup/backend-$TS" || fail "tag backup image"
  docker commit --pause=false wa_backend "$IMG" >/dev/null || fail "commit the running backend (keeps its hot-swapped code)"
  echo "backup image: wa-production-backup/backend-$TS"
fi
# shellcheck disable=SC2086
$C up -d --no-deps --no-build --force-recreate $SERVICES 2>&1 | grep -vi warn
STARTED=$(docker inspect -f '{{.State.StartedAt}}' wa_backend)
sleep "${SETTLE_SECONDS:-30}"

echo "== 6. After"
docker ps --filter "name=wa_" --format '{{.Names}}  {{.Status}}' | grep -E "$(echo $SERVICES | sed 's/ /|/g')"
echo "health: $(curl -s "$HEALTH_URL")"
echo "settings that changed in wa_backend (names only):"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_backend | sort | diff "$SNAP/backend-env-$TS.before" - | grep '^[<>]' | cut -d= -f1 | sort -u
echo "== 7. Webhooks since the restart ($STARTED)"
webhook_report "$STARTED"; rc=$?
echo
case $rc in
  0) echo "OK: incoming webhooks are being accepted." ;;
  2) echo "NOTE: no webhook has arrived yet. Run again in a minute:  bash $0 webhooks 3" ;;
  *) echo "PROBLEM: webhooks are being rejected after this restart. Undo now:"
     echo "  1. cp <your previous settings file> $PFILE   (a backup is the .env.bak-* file you made before editing)"
     echo "  2. $C up -d --no-deps --no-build --force-recreate $SERVICES"
     echo "  then run: bash $0 webhooks 3"
     exit 2 ;;
esac
echo "Delete the snapshot when done: rm $SNAP/backend-env-$TS.before"
