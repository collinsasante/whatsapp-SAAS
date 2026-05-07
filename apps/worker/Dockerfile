FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN npm install -g pnpm@9.1.0

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules
COPY . .
RUN pnpm --filter @whatsapp-platform/shared-types build
RUN pnpm --filter @whatsapp-platform/shared-utils build
RUN ./apps/worker/node_modules/.bin/prisma generate --schema apps/backend/prisma/schema.prisma
RUN pnpm --filter @whatsapp-platform/worker build
RUN pnpm --filter @whatsapp-platform/worker deploy --prod /prod/worker

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/worker/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/apps/worker/package.json ./

EXPOSE 3003
CMD ["node", "dist/index.js"]
