#!/usr/bin/env bash
# STAGING ONLY. Recreates staging containers (compose project verzchat-staging) from infra/.env.staging and refuses to
# proceed when doing so would let staging reuse a production secret or a live payment key. Prints names and 8-character
# fingerprints, never secret values. It only ever touches the wa_staging_* containers.
#
#   read only:  bash staging-recreate.sh check [service...]
#   apply:      bash staging-recreate.sh apply [service...]       (default services: backend worker realtime)
#
# Why this exists: staging was meant to read its own .env.staging (see the header of docker-compose.staging.yml) but was
# started from the shared infra/.env, so staging and production silently shared every secret. A login token signed with
# a shared JWT_SECRET is accepted by the other environment, and a recreate once switched on a staging-only WhatsApp secret
# in production. Keeping staging on its own file, and checking it here, makes that class of mistake impossible to repeat.
set -u
MODE=${1:-}; shift || true
SERVICES=${*:-backend worker realtime}
fail() { echo "ABORT: $*"; exit 1; }
warn() { echo "WARN:  $*"; }
case "$MODE" in check|apply) ;; *) fail "usage: staging-recreate.sh check|apply [service...]";; esac

INFRA=${INFRA_DIR:-/root/whatsapp-platform/infra}
SFILE=${STAGING_ENV_FILE:-$INFRA/.env.staging}
PFILE=${PROD_ENV_FILE:-$INFRA/.env}
COMPOSE_FILE=$INFRA/docker-compose.staging.yml
C="docker compose --env-file $SFILE -f $COMPOSE_FILE"

# Value of KEY in an env file, read as text (the file is never sourced), surrounding quotes removed.
val() { grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/" | tr -d '\r\n'; }
fp() { printf %s "$1" | sha256sum | cut -c1-8; }

echo "== 1. Files"
[ -f "$SFILE" ] || fail "$SFILE does not exist. Create it from infra/.env.staging.example first."
[ -f "$PFILE" ] || fail "$PFILE (production settings, used only for comparison) does not exist."
[ "$SFILE" != "$PFILE" ] || fail "the staging and production settings files are the same file."
case "$(stat -c %a "$SFILE" 2>/dev/null)" in 600|400) ;; *) warn "$SFILE should be readable only by root (chmod 600).";; esac
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found."

echo "== 2. This really is staging"
for s in backend postgres; do
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "wa_staging_$s" 2>/dev/null)" = "verzchat-staging" ] \
    || fail "wa_staging_$s is not part of the verzchat-staging project."
done
DB=$(docker exec wa_staging_backend printenv DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#')
case "$DB" in *_staging) ;; *) fail "the running staging database '$DB' does not look like staging.";; esac
NEWDB=$($C config 2>/dev/null | grep -m1 "DATABASE_URL" | sed -E 's#.*/([^/?"]+).*#\1#')
case "$NEWDB" in *_staging) ;; *) fail "with $SFILE the staging database would be '$NEWDB', not a staging database.";; esac
echo "staging database: $DB"

echo "== 3. Secrets that must differ from production"
for k in JWT_SECRET JWT_REFRESH_SECRET; do
  s=$(val "$SFILE" "$k"); p=$(val "$PFILE" "$k")
  [ -n "$s" ] || fail "$k is empty in $SFILE."
  [ ${#s} -ge 32 ] || fail "$k in $SFILE is shorter than 32 characters."
  [ "$s" != "$p" ] || fail "$k is identical in staging and production: a login token from one would be accepted by the other."
done
s=$(val "$SFILE" PLATFORM_ADMIN_SETUP_SECRET); p=$(val "$PFILE" PLATFORM_ADMIN_SETUP_SECRET)
[ -z "$s" ] || [ "$s" != "$p" ] || fail "PLATFORM_ADMIN_SETUP_SECRET is identical in staging and production."
for k in WHATSAPP_APP_SECRET FACEBOOK_APP_SECRET DEEPSEEK_API_KEY RESEND_API_KEY SMTP_PASS CREDENTIALS_ENCRYPTION_KEY; do
  s=$(val "$SFILE" "$k"); p=$(val "$PFILE" "$k")
  [ -z "$s" ] || [ "$s" != "$p" ] || warn "$k is the same in staging and production (fingerprint $(fp "$s")). Use a separate one when you can."
done

echo "== 4. Payments stay in test mode"
for k in PAYSTACK_SECRET_KEY STRIPE_SECRET_KEY; do
  case "$(val "$SFILE" "$k")" in sk_live_*) fail "$k in $SFILE is a LIVE key. Staging must use test keys.";; esac
done

echo "== 5. No unset settings"
MISSING=$($C config 2>&1 >/dev/null | grep -i "is not set" | sed -E 's/.*The \\*"([A-Za-z0-9_]+)\\*" variable.*/\1/' | sort -u | tr '\n' ' ')
[ -z "$MISSING" ] || fail "these settings are not defined in $SFILE: $MISSING"

echo "all checks passed."
if [ "$MODE" = check ]; then echo "check only: nothing was changed."; exit 0; fi

echo "== 6. Snapshot, then recreate: $SERVICES"
SNAP=${SNAPSHOT_DIR:-/root/staging-env-snapshots}; mkdir -p "$SNAP" && chmod 700 "$SNAP" || fail "cannot create $SNAP"
TS=$(date +%Y%m%d-%H%M%S)
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | sort > "$SNAP/backend-env-$TS.before" && chmod 600 "$SNAP/backend-env-$TS.before"
if echo " $SERVICES " | grep -q " backend "; then
  IMG=$(docker inspect -f '{{.Config.Image}}' wa_staging_backend) || fail "inspect backend"
  docker tag "$IMG" "wa-staging-backup/backend-$TS" || fail "tag backup image"
  docker commit --pause=false wa_staging_backend "$IMG" >/dev/null || fail "commit running backend (keeps its hot-swapped code)"
  echo "backup image: wa-staging-backup/backend-$TS"
fi
# shellcheck disable=SC2086
$C up -d --no-deps --no-build --force-recreate $SERVICES 2>&1 | grep -vi warn
sleep 25

echo "== 7. After"
docker ps --filter "name=wa_staging_" --format '{{.Names}}  {{.Status}}' | grep -E "$(echo $SERVICES | sed 's/ /|/g')"
PUB=$(val "$SFILE" STAGING_PUBLIC_URL)
[ -n "$PUB" ] && echo "health: $(curl -sk "$PUB/api/v1/health")"
echo "settings that changed in wa_staging_backend (names only):"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | sort | diff "$SNAP/backend-env-$TS.before" - | grep '^[<>]' | cut -d= -f1 | sort -u
echo
echo "To undo: recreate with the old shared file:  docker compose --env-file $PFILE -f $COMPOSE_FILE up -d --no-deps --no-build --force-recreate $SERVICES"
echo "(and re-tag wa-staging-backup/backend-$TS to the backend image name if its code is needed back)."
echo "Delete the snapshot when done: rm $SNAP/backend-env-$TS.before"
