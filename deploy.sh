#!/bin/bash
set -e

echo "Resetting auto-generated files to avoid merge conflicts..."
git checkout -- apps/frontend/next-env.d.ts 2>/dev/null || true

echo "Pulling latest code..."
git pull origin main

echo "Rebuilding and restarting services..."
docker compose -f infra/docker-compose.yml up -d --build

echo "Reloading nginx to pick up new container IPs..."
docker compose -f infra/docker-compose.yml restart nginx

echo "Deployment complete!"
