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

if [[ "$TARGET" == "backend" || "$TARGET" == "all" ]]; then
  echo "==> Building backend..."
  pnpm --filter @whatsapp-platform/shared-types build
  pnpm --filter @whatsapp-platform/shared-utils build
  pnpm --filter @whatsapp-platform/backend prisma:generate
  pnpm --filter @whatsapp-platform/backend build

  echo "==> Hot-swapping backend dist..."
  docker cp apps/backend/dist/. wa_backend:/app/dist/
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
  docker cp apps/frontend/.next/. wa_frontend:/app/.next/
  docker restart wa_frontend
  echo "==> Frontend deployed."
fi

echo "==> Done. Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "wa_backend|wa_frontend"
