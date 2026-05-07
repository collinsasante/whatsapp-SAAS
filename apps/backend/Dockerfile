FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN npm install -g pnpm@9.1.0

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules
COPY . .
RUN pnpm --filter @whatsapp-platform/shared-types build
RUN pnpm --filter @whatsapp-platform/shared-utils build
RUN pnpm --filter @whatsapp-platform/backend prisma:generate
RUN pnpm --filter @whatsapp-platform/backend build
RUN pnpm --filter @whatsapp-platform/backend deploy --prod /prod/backend

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/backend/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma

RUN node -e "const v=require('./node_modules/@prisma/client/package.json').version; \
    const {execSync}=require('child_process'); \
    execSync('npm install -g prisma@'+v,{stdio:'inherit'})"
RUN mkdir -p uploads

EXPOSE 3001
CMD ["sh", "-c", "prisma migrate deploy --schema prisma/schema.prisma && node dist/main"]
