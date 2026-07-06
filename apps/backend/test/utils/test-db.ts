import { PrismaClient } from '@prisma/client';
import { UserRole } from '@whatsapp-platform/shared-types';
import { randomUUID } from 'crypto';

/**
 * Shared Prisma client for e2e tests. Import this rather than constructing
 * a new PrismaClient per test file -- keeps connection count bounded.
 */
export const testPrisma = new PrismaClient();

/**
 * Seeds a real Tenant + User row -- required because JwtStrategy re-validates
 * the token's sub/tenantId against the database on every request (see
 * src/auth/strategies/jwt.strategy.ts), so a signed token alone isn't enough.
 */
export async function createTenantWithUser(opts: { role?: UserRole; tenantName?: string } = {}) {
  const tenant = await testPrisma.tenant.create({
    data: {
      name: opts.tenantName ?? `Test Tenant ${randomUUID().slice(0, 8)}`,
      webhookVerifyToken: randomUUID(),
    },
  });
  const user = await testPrisma.user.create({
    data: {
      tenantId: tenant.id,
      name: 'Test User',
      email: `test-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: opts.role ?? UserRole.ADMIN,
      isActive: true,
    },
  });
  return { tenant, user };
}

/**
 * Truncates every table in the public schema (except Prisma's own migration
 * ledger) and restarts identity sequences. Generic by design (reads table
 * names from information_schema) so it never drifts out of sync with the
 * schema as new models are added.
 *
 * Call this in `beforeEach` (not `beforeAll`) so tests don't leak state into
 * each other regardless of execution order.
 */
export async function resetTestDatabase(): Promise<void> {
  const tables: Array<{ tablename: string }> = await testPrisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
  `;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE;`);
}

export async function disconnectTestDatabase(): Promise<void> {
  await testPrisma.$disconnect();
}
