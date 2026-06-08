#!/bin/bash

echo "🚀 Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
pnpm install

echo "🔨 Building project..."
pnpm build

echo "♻️ Restarting services..."
pm2 restart all || true

echo "✅ Deployment complete!"
