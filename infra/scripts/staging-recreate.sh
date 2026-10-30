#!/usr/bin/env bash
# STAGING ONLY. Read-only validation of the staging environment and secret boundary.
# It prints setting names only, never secret values or fingerprints.
#
#   read only:  bash staging-recreate.sh check
#   apply:      disabled; use staging-release-deploy.sh after release approval
#
# Why this exists: staging was meant to read its own .env.staging (see the header of docker-compose.staging.yml) but was
# started from the shared infra/.env, so staging and production silently shared every secret. A login token signed with
# a shared JWT_SECRET is accepted by the other environment, and a recreate once switched on a staging-only WhatsApp secret
# in production. Keeping staging on its own file, and checking it here, makes that class of mistake impossible to repeat.
set -u
MODE=${1:-}
fail() { echo "ABORT: $*"; exit 1; }
warn() { echo "WARN:  $*"; }
case "$MODE" in
  check) ;;
  apply) fail "apply is disabled; use staging-release-deploy.sh to deploy versioned images and migrations.";;
  *) fail "usage: staging-recreate.sh check";;
esac

INFRA=${INFRA_DIR:-/root/whatsapp-platform/infra}
SFILE=${STAGING_ENV_FILE:-$INFRA/.env.staging}
PFILE=${PROD_ENV_FILE:-$INFRA/.env}
COMPOSE_FILE=$INFRA/docker-compose.staging.yml
C="docker compose --env-file $SFILE -f $COMPOSE_FILE"

# Value of KEY in an env file, read as text (the file is never sourced), surrounding quotes removed.
val() { grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/" | tr -d '\r\n'; }

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
  [ -z "$s" ] || [ "$s" != "$p" ] || warn "$k is the same in staging and production. Use a separate one when you can."
done

echo "== 4. Payments stay in test mode"
for k in PAYSTACK_SECRET_KEY STRIPE_SECRET_KEY; do
  case "$(val "$SFILE" "$k")" in sk_live_*) fail "$k in $SFILE is a LIVE key. Staging must use test keys.";; esac
done

echo "== 5. No unset settings"
MISSING=$($C config 2>&1 >/dev/null | grep -i "is not set" | sed -E 's/.*The \\*"([A-Za-z0-9_]+)\\*" variable.*/\1/' | sort -u | tr '\n' ' ')
[ -z "$MISSING" ] || fail "these settings are not defined in $SFILE: $MISSING"

echo "all checks passed."
echo "check only: nothing was changed."
