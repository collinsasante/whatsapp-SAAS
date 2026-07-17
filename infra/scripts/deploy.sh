#!/bin/bash
# Fast deploy: build locally on VPS, hot-swap dist into running containers.
# Avoids full docker image rebuild (saves 3-5 min per deploy).
# Usage: bash infra/scripts/deploy.sh [backend|frontend|all]
set -e

TARGET="${1:-all}"
REPO_ROOT="/root/whatsapp-platform"

cd "$REPO_ROOT"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# This script pulls and builds whatever branch is currently checked out here --
# if that ever drifts off main (e.g. left over from manual staging testing), every
# subsequent automatic deploy silently ships the wrong code with no error, since
# the only downstream check is a health endpoint that can't tell which commit built it.
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: refusing to deploy — this checkout is on '$CURRENT_BRANCH', not 'main'."
  echo "Deploying from here would silently ship '$CURRENT_BRANCH' to production."
  echo "If that's really intended, run: git checkout main && bash $0 $@"
  exit 1
fi

echo "==> Pulling latest code..."
git pull origin "$CURRENT_BRANCH"

# Re-exec the updated script so any changes to deploy.sh itself take effect
if [[ -z "$_DEPLOY_REEXEC" ]]; then
  export _DEPLOY_REEXEC=1
  exec bash "$0" "$@"
fi

# Load production env vars so NEXT_PUBLIC_* are embedded correctly at build time
if [[ -f "$REPO_ROOT/infra/.env" ]]; then
  set -a
  set +e            # don't abort if .env has a stray non-assignment line
  source "$REPO_ROOT/infra/.env"
  set -e
  set +a
fi

if [[ "$TARGET" == "backend" || "$TARGET" == "all" ]]; then
  echo "==> Installing backend dependencies..."
  pnpm install --frozen-lockfile
  echo "==> Building backend..."
  pnpm --filter @whatsapp-platform/shared-types build
  pnpm --filter @whatsapp-platform/shared-utils build
  pnpm --filter @whatsapp-platform/backend prisma:generate
  pnpm --filter @whatsapp-platform/backend build

  # Resolve actual container name (handles hash-prefixed names)
  BACKEND_CTR=$(docker ps --format '{{.Names}}' | grep 'wa_backend' | head -1)
  if [[ -z "$BACKEND_CTR" ]]; then echo "ERROR: wa_backend container not running"; exit 1; fi
  echo "==> Hot-swapping backend dist into $BACKEND_CTR..."
  docker cp apps/backend/dist/. "${BACKEND_CTR}:/app/dist/"
  SHARED_TYPES_CONTAINER_PATH=$(docker exec "${BACKEND_CTR}" node -e "console.log(require.resolve('@whatsapp-platform/shared-types'))" 2>/dev/null | sed 's|/dist/index.js||')
  if [[ -n "$SHARED_TYPES_CONTAINER_PATH" ]]; then
    docker cp packages/shared-types/dist/. "${BACKEND_CTR}:${SHARED_TYPES_CONTAINER_PATH}/dist/"
  fi
  SHARED_UTILS_CONTAINER_PATH=$(docker exec "${BACKEND_CTR}" node -e "console.log(require.resolve('@whatsapp-platform/shared-utils'))" 2>/dev/null | sed 's|/dist/index.js||')
  if [[ -n "$SHARED_UTILS_CONTAINER_PATH" ]]; then
    docker cp packages/shared-utils/dist/. "${BACKEND_CTR}:${SHARED_UTILS_CONTAINER_PATH}/dist/"
  fi
  docker cp apps/backend/prisma/schema.prisma "${BACKEND_CTR}:/app/prisma/schema.prisma"
  docker cp apps/backend/prisma/migrations/. "${BACKEND_CTR}:/app/prisma/migrations/"
  docker exec "${BACKEND_CTR}" sh -c "cd /app && prisma generate --schema prisma/schema.prisma" 2>&1 || true
  echo "==> Running database migrations..."
  docker exec "${BACKEND_CTR}" sh -c "cd /app && prisma migrate deploy --schema prisma/schema.prisma"
  docker restart "${BACKEND_CTR}"

  echo "==> Waiting for backend to be healthy..."
  for i in $(seq 1 20); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${BACKEND_CTR}" 2>/dev/null || echo "none")
    if [[ "$STATUS" == "healthy" || "$STATUS" == "none" ]]; then
      break
    fi
    sleep 3
  done
  echo "==> Backend deployed."
fi

if [[ "$TARGET" == "frontend" || "$TARGET" == "all" ]]; then
  echo "==> Building frontend..."
  rm -rf apps/frontend/.next
  # Next.js 14 standalone bug: tries to rename .next/export/500.html at the end of the build
  # but App Router never creates it — pre-seed the file so the rename succeeds.
  mkdir -p apps/frontend/.next/export apps/frontend/.next/server/pages
  printf '<!DOCTYPE html><html><head><title>500</title></head><body></body></html>' \
    > apps/frontend/.next/export/500.html
  # Always bake production URLs into the bundle regardless of what infra/.env has
  NEXT_PUBLIC_API_URL="https://verzchat.com/api/v1" \
  NEXT_PUBLIC_SOCKET_URL="https://verzchat.com" \
  pnpm --filter @whatsapp-platform/frontend build

  # Resolve actual container name (handles hash-prefixed names like abc123_wa_frontend)
  FRONTEND_CTR=$(docker ps --format '{{.Names}}' | grep 'wa_frontend' | head -1)
  if [[ -z "$FRONTEND_CTR" ]]; then echo "ERROR: wa_frontend container not running"; exit 1; fi
  echo "==> Hot-swapping frontend build into $FRONTEND_CTR..."
  docker cp apps/frontend/.next/static/. "${FRONTEND_CTR}:/app/apps/frontend/.next/static/"
  docker cp apps/frontend/.next/standalone/apps/frontend/.next/server/. "${FRONTEND_CTR}:/app/apps/frontend/.next/server/"
  docker cp apps/frontend/.next/standalone/apps/frontend/server.js "${FRONTEND_CTR}:/app/apps/frontend/server.js"
  for f in apps/frontend/.next/standalone/apps/frontend/.next/*.json apps/frontend/.next/standalone/apps/frontend/.next/BUILD_ID; do
    [[ -f "$f" ]] && docker cp "$f" "${FRONTEND_CTR}:/app/apps/frontend/.next/$(basename "$f")"
  done
  docker cp apps/frontend/public/. "${FRONTEND_CTR}:/app/apps/frontend/public/"
  docker restart "${FRONTEND_CTR}"
  echo "==> Frontend deployed."
fi

echo "==> Reloading nginx..."
docker exec wa_nginx nginx -s reload

echo "==> Done. Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "wa_backend|wa_frontend|wa_nginx|wa_worker|wa_realtime"
