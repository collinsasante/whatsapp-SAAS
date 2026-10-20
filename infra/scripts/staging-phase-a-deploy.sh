#!/usr/bin/env bash
# usage: 02-staging-deploy.sh deploy   <BACKUP_DIR> <BRANCH> <SHA>
#        02-staging-deploy.sh rollback <BACKUP_DIR>
# Staging only (container names wa_staging_*, compose project verzchat-staging). Prints no secrets.
set -u
MODE=${1:-}; B=${2:-}; BRANCH=${3:-}; SHA=${4:-}
fail() { echo "ABORT: $*"; exit 1; }
[ -d "$B" ] && [ -s "$B/MANIFEST.txt" ] || fail "backup dir/manifest missing: $B"
TS=$(basename "$B")
COMPOSE="docker compose -p verzchat-staging -f /root/release-src/infra/docker-compose.staging.yml"

restore_dist() {  # $1=service
  docker cp "$B/dist-$1/." "wa_staging_$1:/app/dist/" && docker restart "wa_staging_$1" >/dev/null
}
restore_frontend() {
  local name; name=$(docker inspect -f '{{.Config.Image}}' wa_staging_frontend)
  docker tag "wa-staging-backup/frontend:$TS" "$name" && (cd /root/release-src/infra 2>/dev/null || cd /root; $COMPOSE up -d --no-deps --no-build --force-recreate frontend 2>&1 | grep -v WARN)
}
healthy() {  # $1=service ; running, no restarts, no fatal in recent logs
  local c=wa_staging_$1
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "true" ] || return 1
  [ "$(docker inspect -f '{{.RestartCount}}' "$c")" = "0" ] || return 1
  ! docker logs --since 25s "$c" 2>&1 | grep -qiE "fatal|unhandled|ECONNREFUSED|PrismaClientInitializationError|Cannot find module"
}

if [ "$MODE" = "rollback" ]; then
  echo "== ROLLBACK to $B"
  for s in backend worker whatsapp_web; do restore_dist $s && echo "restored dist: $s"; done
  restore_frontend && echo "restored frontend image"
  sleep 25; for s in backend worker whatsapp_web frontend; do healthy $s && echo "healthy: $s" || echo "NOT HEALTHY: $s"; done
  exit 0
fi
[ "$MODE" = "deploy" ] && [ -n "$BRANCH" ] && [ ${#SHA} -eq 40 ] || fail "usage: deploy <BACKUP_DIR> <BRANCH> <40-char SHA>"

echo "== 1. Staging guard"
for s in backend worker whatsapp_web frontend postgres; do
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' wa_staging_$s)" = "verzchat-staging" ] || fail "wa_staging_$s not in verzchat-staging"
done

echo "== 2. Export exact commit (no .git, no worktree)"
git -C /root/whatsapp-platform fetch -q origin "$BRANCH" || fail "fetch"
[ "$(git -C /root/whatsapp-platform rev-parse FETCH_HEAD)" = "$SHA" ] || fail "branch tip is not $SHA"
rm -rf /root/release-src; mkdir /root/release-src; git -C /root/whatsapp-platform archive "$SHA" | tar -x -C /root/release-src || fail "export"
grep -q "isViewOnceMessage" /root/release-src/apps/whatsapp-web/src/session-manager.ts || fail "view-once fix missing from export"
grep -q "clientMessageId" /root/release-src/apps/backend/src/messages/messages.service.ts || fail "phase A missing from export"
grep -q "isConversationHumanHandled" /root/release-src/apps/backend/src/messages/messages.service.ts || fail "takeover fix missing from export"

echo "== 2b. Recover the frontend's baked build URLs (NEXT_PUBLIC_* are not in the container env)"
ARGS="$B/frontend-build-args.env"
if [ ! -s "$ARGS" ]; then
  API=$(docker exec wa_staging_frontend sh -c "grep -rhoE 'https?://[^\"\\\\ ]+/api/v1' /app/apps/frontend/.next 2>/dev/null" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  [ -n "$API" ] || fail "could not recover NEXT_PUBLIC_API_URL from the running frontend; refusing to build a frontend with a blank API URL"
  SENTRY=$(docker exec wa_staging_frontend sh -c "grep -rhoE 'https://[a-f0-9]+@[A-Za-z0-9.]+/[0-9]+' /app/apps/frontend/.next 2>/dev/null" | sort -u | head -1)
  { echo "NEXT_PUBLIC_API_URL=$API"; echo "NEXT_PUBLIC_SOCKET_URL=${API%/api/v1}"; echo "NEXT_PUBLIC_SENTRY_DSN=${SENTRY:-}"; echo "NEXT_PUBLIC_SHOW_DEV_TOOLS=true"; } > "$ARGS"; chmod 600 "$ARGS"
fi
grep -q '^NEXT_PUBLIC_API_URL=http' "$ARGS" || fail "frontend build args invalid"
echo "frontend will be built with: $(grep -E '^NEXT_PUBLIC_(API|SOCKET)_URL' "$ARGS" | tr '\n' ' ')"

echo "== 3. Build on host (dependencies unchanged; no schema change)"
cd /root/release-src || fail cd
pnpm install --frozen-lockfile --ignore-scripts >/dev/null 2>&1 || fail "pnpm install"
pnpm --filter @whatsapp-platform/backend prisma:generate >/dev/null 2>&1 || fail "prisma generate"
pnpm --filter @whatsapp-platform/shared-types --filter @whatsapp-platform/shared-utils build >/dev/null 2>&1 || fail "shared build"
for p in backend worker whatsapp-web; do pnpm --filter "@whatsapp-platform/$p" build >/dev/null 2>&1 || fail "build $p"; [ -d apps/$p/dist ] || fail "no dist for $p"; done
docker build -q -f apps/frontend/Dockerfile $(sed 's/^/--build-arg /' "$B/frontend-build-args.env" | tr '\n' ' ') -t wa-staging-frontend-new:$TS . >/dev/null || fail "frontend image build (nothing deployed yet)"
echo "build OK"

rollback_now() { echo "!! $1 -> rolling back"; bash "$0" rollback "$B"; exit 1; }

echo "== 4. Swap (backend, worker, whatsapp_web: dist only, env untouched; then frontend image)"
for pair in backend:backend worker:worker whatsapp_web:whatsapp-web; do
  s=${pair%%:*}; p=${pair##*:}
  docker cp "apps/$p/dist/." "wa_staging_$s:/app/dist/" && docker restart "wa_staging_$s" >/dev/null || rollback_now "swap $s"
  sleep 25; healthy $s || rollback_now "$s unhealthy"; echo "healthy: $s"
done
name=$(docker inspect -f '{{.Config.Image}}' wa_staging_frontend); docker tag "wa-staging-frontend-new:$TS" "$name" || rollback_now "tag frontend"
(cd infra && $COMPOSE up -d --no-deps --no-build --force-recreate frontend 2>&1 | grep -v WARN)
sleep 20; healthy frontend || rollback_now "frontend unhealthy"; echo "healthy: frontend"
echo "DEPLOYED $SHA to staging. Backup/rollback: $B"
