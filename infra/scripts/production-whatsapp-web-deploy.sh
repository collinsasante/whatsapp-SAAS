#!/usr/bin/env bash
# PRODUCTION. Updates ONLY the WhatsApp Web (QR) service, container wa_whatsapp_web. Prints no secrets.
#
# Why this exists: CI and infra/scripts/deploy.sh only update the backend, frontend, worker and realtime. The WhatsApp Web
# service is a separate container, so its code changes never reach production through a normal release.
#
# Run it by hand, and only AFTER the backend release is live: the new service sends inbound payloads (WhatsApp address,
# placeholders) that an older backend does not understand. The script refuses to run otherwise.
#
#   check:    CONFIRM_PRODUCTION=yes bash production-whatsapp-web-deploy.sh check                      (read only)
#   deploy:   CONFIRM_PRODUCTION=yes bash production-whatsapp-web-deploy.sh deploy <BRANCH> <40-char SHA>
#   rollback: CONFIRM_PRODUCTION=yes bash production-whatsapp-web-deploy.sh rollback <SNAPSHOT_DIR>
#
# What a deploy does to the running service: it copies new code into the container and restarts it. Sessions are stored in
# Postgres, so connected numbers reconnect by themselves after the restart (a few seconds); nobody has to rescan a QR code.
# It makes no database change and does not touch the backend, frontend, worker, realtime, nginx or any environment file.
set -u
MODE=${1:-}
fail() { echo "ABORT: $*"; exit 1; }
[ "${CONFIRM_PRODUCTION:-}" = "yes" ] || fail "this is PRODUCTION. Re-run with CONFIRM_PRODUCTION=yes to proceed."
case "$MODE" in check|deploy|rollback) ;; *) fail "usage: check | deploy <BRANCH> <SHA> | rollback <SNAPSHOT_DIR>";; esac

REPO=/root/whatsapp-platform
SRC=/root/release-src-prod-ww        # its own folder: never the staging export, never the production checkout
SHARED="shared-utils shared-types"
WW=$(docker ps --format '{{.Names}}' | grep -x 'wa_whatsapp_web' | head -1)
BACKEND=$(docker ps --format '{{.Names}}' | grep 'wa_backend' | head -1)
[ -n "$WW" ] || fail "wa_whatsapp_web is not running"
[ -n "$BACKEND" ] || fail "wa_backend is not running"
WW_RC0=$(docker inspect -f '{{.RestartCount}}' "$WW"); BACKEND_RC0=$(docker inspect -f '{{.RestartCount}}' "$BACKEND")

pkg_dir() {  # directory of a workspace package inside a container: $1=container $2=package
  docker exec "$1" node -e "console.log(require('path').dirname(require.resolve('@whatsapp-platform/$2/package.json')))" 2>/dev/null
}
restarts() { docker inspect -f '{{.RestartCount}}' "$1"; }
# $1=container $2=restart count before we touched it. A manual `docker restart` does not change RestartCount, but a crash
# loop does, so a rise means the service is unstable. (The count is not expected to be 0: old crashes stay counted.)
healthy() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1")" = "true" ] || return 1
  [ "$(restarts "$1")" = "$2" ] || return 1
  ! docker logs --since 25s "$1" 2>&1 | grep -qiE "fatal|unhandled|ECONNREFUSED|PrismaClientInitializationError|Cannot find module|is not a function"
}
verify_shared() {  # the new shared-utils functions must exist inside the given container
  docker exec "$1" node -e "const u=require('@whatsapp-platform/shared-utils');for(const f of ['classifyJid','usableContactName','isPlausiblePhoneDigits','normalizePhone','isBsuid']){if(typeof u[f]!=='function'){console.error('missing '+f);process.exit(1)}}" >/dev/null 2>&1
}

preflight() {
  echo "== Preflight (read only)"
  local db; db=$(docker exec "$WW" printenv DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#')
  case "$db" in *staging*) fail "database '$db' looks like staging, not production";; esac
  echo "service:   $WW  ($(docker inspect -f '{{.State.Status}}, up since {{.State.StartedAt}}' "$WW"))"
  echo "backend:   $BACKEND  ($(docker inspect -f '{{.State.Status}}' "$BACKEND"))"
  verify_shared "$BACKEND" || fail "the production backend does not have the new shared-utils yet. Deploy the backend release first."
  echo "backend release present: yes (new shared-utils functions found)"
  [ "$(docker exec "$BACKEND" printenv WHATSAPP_WEB_INTERNAL_API_KEY | wc -c)" -gt 1 ] || fail "backend has no WHATSAPP_WEB_INTERNAL_API_KEY"
  [ "$(docker exec "$WW" printenv WHATSAPP_WEB_INTERNAL_API_KEY | wc -c)" -gt 1 ] || fail "wa_whatsapp_web has no WHATSAPP_WEB_INTERNAL_API_KEY"
  echo "internal api key set on both services: yes"
  local free; free=$(df -Pm /root | awk 'NR==2{print $4}'); [ "${free:-0}" -gt 3000 ] || fail "less than 3 GB free on /root"
  echo "free disk on /root: ${free} MB"
}

restore_snapshot() {  # $1 = snapshot dir
  local D=$1
  [ -d "$D/dist" ] && docker cp "$D/dist/." "$WW:/app/dist/" >/dev/null
  for p in $SHARED; do
    local dir; dir=$(pkg_dir "$WW" "$p"); [ -n "$dir" ] && [ -d "$D/$p" ] && docker cp "$D/$p/." "$WW:$dir/" >/dev/null
  done
  docker restart "$WW" >/dev/null
  sleep 25
  healthy "$WW" "$WW_RC0" && echo "healthy after restore: $WW" || echo "NOT HEALTHY after restore: $WW (check: docker logs --tail 80 $WW)"
}

if [ "$MODE" = "check" ]; then preflight; echo "check passed. Nothing was changed."; exit 0; fi

if [ "$MODE" = "rollback" ]; then
  D=${2:-}; [ -d "$D" ] && [ -s "$D/TAG" ] || fail "snapshot dir missing: $D"
  echo "== ROLLBACK $WW to $D"; restore_snapshot "$D"; exit 0
fi

BRANCH=${2:-}; SHA=${3:-}
[ -n "$BRANCH" ] && [ ${#SHA} -eq 40 ] || fail "usage: deploy <BRANCH> <40-char SHA>"
preflight

echo "== 1. Snapshot the CURRENT service (code, shared packages, image)"
TS=$(date +%Y%m%d-%H%M%S); D=/root/production-release-backups/whatsapp-web-$TS
mkdir -p "$D" && chmod 700 "$D" || fail "cannot create $D"
echo "$TS" > "$D/TAG"
docker tag "$(docker inspect -f '{{.Config.Image}}' "$WW")" "wa-production-backup/whatsapp-web:$TS" || fail "tag image"
docker cp "$WW:/app/dist" "$D/dist" >/dev/null || fail "copy dist"; [ -n "$(ls -A "$D/dist")" ] || fail "dist snapshot empty"
for p in $SHARED; do
  dir=$(pkg_dir "$WW" "$p"); [ -n "$dir" ] || fail "cannot locate $p inside $WW"
  docker cp "$WW:$dir" "$D/$p" >/dev/null || fail "copy $p"; [ -n "$(ls -A "$D/$p")" ] || fail "$p snapshot empty"
done
echo "snapshot OK: $D"; echo "ROLLBACK COMMAND: CONFIRM_PRODUCTION=yes bash $0 rollback $D"

echo "== 2. Export the exact commit (the production checkout is not touched)"
git -C "$REPO" fetch -q origin "$BRANCH" || fail "fetch $BRANCH"
[ "$(git -C "$REPO" rev-parse FETCH_HEAD)" = "$SHA" ] || fail "tip of $BRANCH is not $SHA"
rm -rf "$SRC"; mkdir "$SRC"; git -C "$REPO" archive "$SHA" | tar -x -C "$SRC" || fail "export"
grep -q "extractInboundContent" "$SRC/apps/whatsapp-web/src/inbound-content.ts" || fail "WhatsApp Web fixes missing from the export"

echo "== 3. Build on the host at low priority (nothing in production has changed yet)"
cd "$SRC" || fail cd
echo "  3a dependencies";    nice -n 10 pnpm install --frozen-lockfile --ignore-scripts >/dev/null 2>&1 || fail "pnpm install"
echo "  3b prisma generate"; nice -n 10 pnpm --filter @whatsapp-platform/backend prisma:generate >/dev/null 2>&1 || fail "prisma generate"
echo "  3c shared packages"; nice -n 10 pnpm --filter @whatsapp-platform/shared-types --filter @whatsapp-platform/shared-utils build >/dev/null 2>&1 || fail "shared build"
node -e "const u=require('./packages/shared-utils/dist');for(const f of ['classifyJid','usableContactName','isBsuid']){if(typeof u[f]!=='function')process.exit(1)}" || fail "built shared-utils is missing the new functions"
echo "  3d whatsapp-web";    nice -n 10 pnpm --filter @whatsapp-platform/whatsapp-web build >/dev/null 2>&1 || fail "build whatsapp-web"
[ -d apps/whatsapp-web/dist ] || fail "no dist for whatsapp-web"
echo "build OK"

rollback_now() { echo "!! $1 -> rolling back"; restore_snapshot "$D"; exit 1; }

echo "== 4. Swap: shared packages first (verified), then code, then restart"
for p in $SHARED; do
  dir=$(pkg_dir "$WW" "$p"); [ -n "$dir" ] || rollback_now "locate $p"
  docker cp "packages/$p/dist/." "$WW:$dir/dist/" >/dev/null || rollback_now "copy $p"
done
verify_shared "$WW" || rollback_now "$WW does not see the new shared-utils functions"
docker cp apps/whatsapp-web/dist/. "$WW:/app/dist/" >/dev/null || rollback_now "copy code"
docker restart "$WW" >/dev/null || rollback_now "restart"
sleep 25
healthy "$WW" "$WW_RC0" || rollback_now "$WW unhealthy"
healthy "$BACKEND" "$BACKEND_RC0" || rollback_now "$BACKEND unhealthy after the restart"
echo "healthy: $WW and $BACKEND"
echo "DEPLOYED $SHA to the production WhatsApp Web service."
echo "ROLLBACK COMMAND: CONFIRM_PRODUCTION=yes bash $0 rollback $D"
echo "Now check in the app that your QR channels show Connected, then send one test message from your own phone."
