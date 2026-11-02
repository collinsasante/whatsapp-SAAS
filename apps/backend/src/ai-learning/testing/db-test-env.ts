import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Real-PostgreSQL test support for AI Learning. Suites are skipped unless AI_LEARNING_TEST_DATABASE_URL is set, and refuse to run
 * against anything but a local database whose name ends in "test" (they write and delete rows):
 *
 *   AI_LEARNING_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/ailtest  [AI_LEARNING_TEST_REDIS_URL=redis://127.0.0.1:6379]
 */
export const learningDbUrl = (() => {
  const url = process.env['AI_LEARNING_TEST_DATABASE_URL'];
  if (!url) return undefined;
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.slice(1).endsWith('test')) {
    throw new Error(`Refusing to run AI Learning database tests against ${u.hostname}${u.pathname}: it must be a local database whose name ends in "test".`);
  }
  return url;
})();

/**
 * A database used by exactly ONE spec file. Needed by assertions about the platform-wide (global) cap, whose total spans every workspace
 * in the database, so any other suite writing to the same database in parallel would change it.
 *
 *   AI_LEARNING_TEST_ISOLATED_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/ailiso_test
 */
export const isolatedDbUrl = (() => {
  const url = process.env['AI_LEARNING_TEST_ISOLATED_DATABASE_URL'];
  if (!url) return undefined;
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.slice(1).endsWith('test')) {
    throw new Error(`Refusing to run AI Learning database tests against ${u.hostname}${u.pathname}: it must be a local database whose name ends in "test".`);
  }
  if (url === process.env['AI_LEARNING_TEST_DATABASE_URL']) throw new Error('AI_LEARNING_TEST_ISOLATED_DATABASE_URL must differ from AI_LEARNING_TEST_DATABASE_URL.');
  return url;
})();
export const isolatedDbSuite = isolatedDbUrl ? describe : describe.skip;
export function newIsolatedTestClient(): PrismaClient {
  return isolatedDbUrl ? new PrismaClient({ datasources: { db: { url: isolatedDbUrl } } }) : (undefined as unknown as PrismaClient);
}

export const learningRedisUrl = process.env['AI_LEARNING_TEST_REDIS_URL'];
export const dbSuite = learningDbUrl ? describe : describe.skip;
export const queueSuite = learningDbUrl && learningRedisUrl ? describe : describe.skip;

export function newTestClient(): PrismaClient {
  // describe.skip still runs the body, so nothing is created unless the suite is enabled.
  return learningDbUrl ? new PrismaClient({ datasources: { db: { url: learningDbUrl } } }) : (undefined as unknown as PrismaClient);
}

/** Small factory over a PrismaClient; every tenant it creates is removed by cleanup() (everything else hangs off the tenant). */
export function makeFixtures(prisma: PrismaClient) {
  const tag = randomUUID().slice(0, 8);
  const tenants: string[] = [];
  return {
    tag,
    async tenant(name = 'T') {
      const t = await prisma.tenant.create({ data: { name: `${name}-${tag}`, webhookVerifyToken: randomUUID() } });
      tenants.push(t.id);
      return t.id;
    },
    async user(tenantId: string, name = 'agent') {
      return prisma.user.create({ data: { tenantId, email: `${name}-${tag}-${randomUUID().slice(0, 6)}@t.test`, name, passwordHash: 'x', role: 'ADMIN' } as never });
    },
    async conversation(tenantId: string) {
      const contact = await prisma.contact.create({ data: { tenantId, phone: `+23355${Math.floor(Math.random() * 1e7)}`, name: 'Cust' } });
      const conversation = await prisma.conversation.create({ data: { tenantId, contactId: contact.id } });
      return { contact, conversation };
    },
    async cleanup() {
      for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    },
  };
}
