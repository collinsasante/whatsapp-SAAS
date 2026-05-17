#!/bin/bash
# Fast deploy: build locally on VPS, hot-swap dist into running containers.
# Avoids full docker image rebuild (saves 3-5 min per deploy).
# Usage: bash infra/scripts/deploy.sh [backend|frontend|all]
set -e

TARGET="${1:-all}"
REPO_ROOT="/root/whatsapp-platform"

echo "==> Pulling latest code..."
cd "$REPO_ROOT"
git pull origin main

# Load production env vars so NEXT_PUBLIC_* are embedded correctly at build time
if [[ -f "$REPO_ROOT/infra/.env" ]]; then
  set -a
  source "$REPO_ROOT/infra/.env"
  set +a
fi

if [[ "$TARGET" == "backend" || "$TARGET" == "all" ]]; then
  echo "==> Building backend..."
  pnpm --filter @whatsapp-platform/shared-types build
  pnpm --filter @whatsapp-platform/shared-utils build
  pnpm --filter @whatsapp-platform/backend prisma:generate
  pnpm --filter @whatsapp-platform/backend build

  echo "==> Hot-swapping backend dist..."
  docker cp apps/backend/dist/. wa_backend:/app/dist/
  SHARED_TYPES_CONTAINER_PATH=$(docker exec wa_backend node -e "console.log(require.resolve('@whatsapp-platform/shared-types'))" 2>/dev/null | sed 's|/dist/index.js||')
  if [[ -n "$SHARED_TYPES_CONTAINER_PATH" ]]; then
    docker cp packages/shared-types/dist/. "wa_backend:${SHARED_TYPES_CONTAINER_PATH}/dist/"
  fi
  docker restart wa_backend

  echo "==> Waiting for backend to be healthy..."
  for i in $(seq 1 20); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' wa_backend 2>/dev/null || echo "none")
    if [[ "$STATUS" == "healthy" || "$STATUS" == "none" ]]; then
      break
    fi
    sleep 3
  done
  echo "==> Backend deployed."
fi

if [[ "$TARGET" == "frontend" || "$TARGET" == "all" ]]; then
  echo "==> Building frontend..."
  pnpm --filter @whatsapp-platform/frontend build

  echo "==> Hot-swapping frontend build..."
  # Static JS/CSS chunks — served from /app/apps/frontend/.next/static/ in the container
  docker cp apps/frontend/.next/static/. wa_frontend:/app/apps/frontend/.next/static/
  # Server-side code and manifests — from standalone output
  docker cp apps/frontend/.next/standalone/apps/frontend/.next/server/. wa_frontend:/app/apps/frontend/.next/server/
  docker cp apps/frontend/.next/standalone/apps/frontend/server.js wa_frontend:/app/apps/frontend/server.js
  # Build manifests at .next/ root
  for f in apps/frontend/.next/standalone/apps/frontend/.next/*.json apps/frontend/.next/standalone/apps/frontend/.next/BUILD_ID; do
    [[ -f "$f" ]] && docker cp "$f" "wa_frontend:/app/apps/frontend/.next/$(basename "$f")"
  done
  docker restart wa_frontend
  echo "==> Frontend deployed."
fi

echo "==> Reloading nginx to re-resolve upstream IPs..."
docker exec wa_nginx nginx -s reload

echo "==> Done. Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "wa_backend|wa_frontend|wa_nginx"
