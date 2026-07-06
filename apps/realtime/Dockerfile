FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@9.1.0

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY patches ./patches
COPY apps/realtime/package.json ./apps/realtime/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/realtime/node_modules ./apps/realtime/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY . .
RUN pnpm --filter @whatsapp-platform/shared-types build
RUN pnpm --filter @whatsapp-platform/realtime build
RUN pnpm --filter @whatsapp-platform/realtime deploy --prod /prod/realtime

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/realtime/node_modules ./node_modules
COPY --from=builder /app/apps/realtime/dist ./dist

EXPOSE 3002
CMD ["node", "dist/index.js"]
