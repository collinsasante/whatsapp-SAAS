FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
RUN npm install -g pnpm@9.1.0

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY patches ./patches
COPY apps/whatsapp-web/package.json ./apps/whatsapp-web/
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/whatsapp-web/node_modules ./apps/whatsapp-web/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules
COPY . .
RUN pnpm --filter @whatsapp-platform/shared-types build
RUN pnpm --filter @whatsapp-platform/shared-utils build
# Must run before this service's own build -- it typechecks against the
# generated PrismaClient (WhatsAppWebSession), so a stale/ungenerated client
# fails the build the moment it references a field added by a recent
# migration. Same pattern apps/worker's Dockerfile already uses.
RUN pnpm --filter @whatsapp-platform/backend prisma:generate
RUN pnpm --filter @whatsapp-platform/whatsapp-web build
RUN pnpm --filter @whatsapp-platform/whatsapp-web deploy --prod /prod/whatsapp-web
RUN mkdir -p /prod/whatsapp-web/prisma && \
    cp apps/backend/prisma/schema.prisma /prod/whatsapp-web/prisma/schema.prisma && \
    cd /prod/whatsapp-web && \
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('./package.json'));p.devDependencies=Object.assign(p.devDependencies||{},{prisma:require('/app/apps/backend/node_modules/prisma/package.json').version});fs.writeFileSync('./package.json',JSON.stringify(p));" && \
    /app/apps/backend/node_modules/.bin/prisma generate

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /prod/whatsapp-web/node_modules ./node_modules
COPY --from=builder /app/apps/whatsapp-web/dist ./dist
COPY --from=builder /app/apps/whatsapp-web/package.json ./

EXPOSE 3004
CMD ["node", "dist/index.js"]
