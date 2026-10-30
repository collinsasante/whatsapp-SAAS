/**
 * Real-infrastructure checks: a real Postgres (every migration applied, including 20261030120000_ai_digital_self) and a real
 * Redis/BullMQ. Skipped unless DIGITAL_SELF_TEST_DATABASE_URL (+ DIGITAL_SELF_TEST_REDIS_URL for the queue part) is set, and it
 * refuses to run against anything but a local database whose name ends in "test", because it writes and deletes rows.
 *
 *   DIGITAL_SELF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/dstest DIGITAL_SELF_TEST_REDIS_URL=redis://127.0.0.1:6379 npx jest digital-self.db
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DigitalSelfService } from './digital-self.service';
import { DigitalSelfLearningService } from './digital-self-learning.service';
import { DigitalSelfLearningProcessor } from './digital-self-learning.processor';
import { DigitalSelfLearningTrigger } from './digital-self-learning.trigger';
import { DigitalSelfContextService } from './digital-self-context.service';

const dbUrl = process.env['DIGITAL_SELF_TEST_DATABASE_URL'];
const redisUrl = process.env['DIGITAL_SELF_TEST_REDIS_URL'];
const guarded = (() => {
  if (!dbUrl) return false;
  const u = new URL(dbUrl);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.slice(1).endsWith('test')) {
    throw new Error(`Refusing to run Digital Self integration tests against ${u.hostname}${u.pathname}: it must be a local database whose name ends in "test".`);
  }
  return true;
})();
const suite = guarded ? describe : describe.skip;
const queueSuite = guarded && redisUrl ? describe : describe.skip;

const ADMIN_TEXT = ["Hello! I'd be happy to help 😊 What size are you looking for? Let me know, thank you!", 'Hi! Sure 😊 Which colour do you prefer? Thank you!'];

suite('Digital Self against a real database', () => {
  // describe.skip still runs this body, so nothing is built unless the suite is actually enabled.
  const prisma = guarded ? new PrismaClient({ datasources: { db: { url: dbUrl } } }) : (undefined as unknown as PrismaClient);
  const tag = randomUUID().slice(0, 8);
  const tenants: string[] = [];

  async function tenant(name: string) {
    const t = await prisma.tenant.create({ data: { name: `${name}-${tag}`, webhookVerifyToken: randomUUID() } });
    tenants.push(t.id);
    return t.id;
  }
  const user = (tenantId: string, name: string, over: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { tenantId, email: `${name}-${tag}-${randomUUID().slice(0, 4)}@t.test`, name, passwordHash: 'x', role: 'AGENT', ...over } as never });
  async function convo(tenantId: string, assignedToId?: string) {
    const contact = await prisma.contact.create({ data: { tenantId, phone: `+23355${Math.floor(Math.random() * 1e7)}`, name: 'Cust' } });
    const conversation = await prisma.conversation.create({ data: { tenantId, contactId: contact.id, assignedToId } });
    return { contact, conversation };
  }
  const msg = (tenantId: string, conversationId: string, contactId: string, senderId: string | null, content: string, over: Record<string, unknown> = {}) =>
    prisma.message.create({ data: { tenantId, conversationId, contactId, senderId, direction: 'OUTBOUND', type: 'TEXT', content, ...over } as never });

  const svc = new DigitalSelfService(prisma as never);
  const learning = new DigitalSelfLearningService(prisma as never);
  const flagsOn = { isEnabledCached: async () => true };

  afterAll(async () => {
    // Only this run's rows: cascade from the tenants it created.
    await prisma.conversation.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    await prisma.$disconnect();
  });

  it('migration backfill: gives existing agents a Digital Self, skips the AI user and viewers, and is idempotent', async () => {
    const t = await tenant('backfill');
    const [ama, kofi, ai, viewer] = await Promise.all([user(t, 'ama'), user(t, 'kofi', { role: 'ADMIN' }), user(t, 'verz', { isAiAgent: true, isActive: false }), user(t, 'view', { role: 'VIEWER' })]);
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261030120000_ai_digital_self/migration.sql'), 'utf8');
    const backfill = sql.slice(sql.indexOf('INSERT INTO "digital_selves"'));
    await prisma.$executeRawUnsafe(backfill);
    await prisma.$executeRawUnsafe(backfill); // second run: no error, no duplicates
    const rows = await prisma.digitalSelf.findMany({ where: { tenantId: t } });
    expect(rows.map((r) => r.userId).sort()).toEqual([ama.id, kofi.id].sort());
    expect(rows.every((r) => r.status === 'INITIALIZING' && r.evidenceCount === 0)).toBe(true);
    expect(rows.find((r) => r.userId === ai.id || r.userId === viewer.id)).toBeUndefined();
  });

  it('provisioning is idempotent under concurrency and tenant-scoped', async () => {
    const [a, b] = [await tenant('prov-a'), await tenant('prov-b')];
    const ama = await user(a, 'ama');
    await user(b, 'bea');
    await Promise.all([svc.ensureForTenant(a), svc.ensureForTenant(a), svc.ensureForUser(a, ama.id), svc.ensureForUser(a, ama.id)]);
    expect(await prisma.digitalSelf.count({ where: { tenantId: a } })).toBe(1);
    expect(await prisma.digitalSelf.count({ where: { tenantId: b } })).toBe(0);
    expect(await svc.ensureForUser(b, ama.id)).toBeNull(); // another tenant's user id
  });

  it('learns from human replies only, counts concurrent replies exactly once each, and never stores text', async () => {
    const t = await tenant('learn');
    const ama = await user(t, 'ama');
    const verz = await user(t, 'verz', { isAiAgent: true, isActive: false });
    const { contact, conversation } = await convo(t);
    await svc.ensureForUser(t, ama.id);

    const human = await Promise.all(Array.from({ length: 12 }, (_, i) => msg(t, conversation.id, contact.id, ama.id, `${ADMIN_TEXT[i % 2]} ref ${i}`)));
    const ai = await msg(t, conversation.id, contact.id, verz.id, 'Hello from the AI');
    const aiNoSender = await msg(t, conversation.id, contact.id, null, 'Hello, no sender');
    const customer = await msg(t, conversation.id, contact.id, null, 'I want a shirt', { direction: 'INBOUND' });
    const tpl = await msg(t, conversation.id, contact.id, ama.id, 'Template body', { templateId: randomUUID() }).catch(() => null);

    // 12 distinct replies plus the SAME reply delivered twice, all at once.
    const outcomes = await Promise.all([...human.map((m) => learning.learnFromMessage(t, m.id)), learning.learnFromMessage(t, human[0]!.id), learning.learnFromMessage(t, human[0]!.id)]);
    expect(outcomes.filter((o) => o === 'learned')).toHaveLength(12);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(2);
    expect(await Promise.all([ai, aiNoSender, customer].map((m) => learning.learnFromMessage(t, m.id)))).toEqual(['ineligible', 'ineligible', 'ineligible']);
    if (tpl) expect(await learning.learnFromMessage(t, tpl.id)).toBe('ineligible');

    const self = await prisma.digitalSelf.findFirstOrThrow({ where: { tenantId: t, userId: ama.id } });
    expect(self.evidenceCount).toBe(12); // no lost update, no double count
    expect((self.profile as { samples: number }).samples).toBe(12);
    expect(self.status).toBe('LEARNING');
    expect(self.lastLearnedAt).not.toBeNull();
    expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(12);
    expect(JSON.stringify(self.profile)).not.toMatch(/happy to help|ref \d/); // accumulators only
  });

  it('another tenant\'s message id cannot be learned through this tenant', async () => {
    const [a, b] = [await tenant('iso-a'), await tenant('iso-b')];
    const bea = await user(b, 'bea');
    const { contact, conversation } = await convo(b);
    const m = await msg(b, conversation.id, contact.id, bea.id, 'Hello there, how can I help?');
    expect(await learning.learnFromMessage(a, m.id)).toBe('ineligible');
    expect(await prisma.digitalSelf.count({ where: { tenantId: a } })).toBe(0);
  });

  it('pause stops learning; reset forgets it and clears the ledger; overrides survive a reset', async () => {
    const t = await tenant('ctl');
    const ama = await user(t, 'ama');
    const { contact, conversation } = await convo(t);
    const self = (await svc.ensureForUser(t, ama.id))!;
    const m1 = await msg(t, conversation.id, contact.id, ama.id, 'Hello! Happy to help.');
    await svc.setLearningPaused(t, self.id, true);
    expect(await learning.learnFromMessage(t, m1.id)).toBe('paused');
    await svc.setLearningPaused(t, self.id, false);
    expect(await learning.learnFromMessage(t, m1.id)).toBe('learned');
    await svc.setOverrides(t, self.id, { emoji: 'none' });
    const reset = await svc.reset(t, self.id);
    expect(reset).toMatchObject({ evidenceCount: 0, status: 'INITIALIZING' });
    expect(reset.summary.overridden).toEqual(['emoji']);
    expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(0);
    await expect(svc.reset(randomUUID(), self.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assignment with real foreign keys: tenant-checked, ownership untouched, deactivation blocks it', async () => {
    const [a, b] = [await tenant('asg-a'), await tenant('asg-b')];
    const [ama, kofi, bea] = [await user(a, 'ama'), await user(a, 'kofi'), await user(b, 'bea')];
    const dsAma = (await svc.ensureForUser(a, ama.id))!;
    const dsKofi = (await svc.ensureForUser(a, kofi.id))!;
    const dsBea = (await svc.ensureForUser(b, bea.id))!;
    const { conversation } = await convo(a, kofi.id); // Kofi owns it
    const admin = { id: ama.id, role: 'ADMIN' };

    const first = await svc.assignToConversation(a, conversation.id, dsAma.id, admin);
    expect(first).toMatchObject({ source: 'assigned', digitalSelf: { id: dsAma.id } });
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.assignedToId).toBe(kofi.id); // human ownership untouched
    expect(after.digitalSelfId).toBe(dsAma.id);

    await expect(svc.assignToConversation(a, conversation.id, dsBea.id, admin)).rejects.toBeInstanceOf(NotFoundException); // other tenant's Digital Self
    await svc.assignToConversation(a, conversation.id, dsKofi.id, admin);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).digitalSelfId).toBe(dsKofi.id);

    await prisma.user.update({ where: { id: ama.id }, data: { isActive: false } });
    await expect(svc.assignToConversation(a, conversation.id, dsAma.id, { id: kofi.id, role: 'ADMIN' })).rejects.toBeInstanceOf(BadRequestException);
    await prisma.workspaceMember.create({ data: { workspaceId: a, userId: kofi.id, role: 'AGENT', status: 'SUSPENDED' } });
    await expect(svc.assignToConversation(a, conversation.id, dsKofi.id, { id: kofi.id, role: 'ADMIN' })).rejects.toBeInstanceOf(BadRequestException);

    const removed = await svc.assignToConversation(a, conversation.id, null, { id: kofi.id, role: 'ADMIN' });
    expect(removed.source).toBe('owner'); // falls back to the human owner's, not to a random agent
    await prisma.digitalSelf.delete({ where: { id: dsKofi.id } }); // FK: SetNull, conversation survives
    expect(await prisma.conversation.count({ where: { id: conversation.id } })).toBe(1);
  });

  it('the style comes from the assigned Digital Self, changes when assignment changes, and stops when the agent is deactivated', async () => {
    const t = await tenant('ctx');
    const [ama, kofi] = [await user(t, 'ama'), await user(t, 'kofi')];
    const { contact, conversation } = await convo(t);
    const [dsAma, dsKofi] = [(await svc.ensureForUser(t, ama.id))!, (await svc.ensureForUser(t, kofi.id))!];
    await Promise.all(Array.from({ length: 12 }, (_, i) => msg(t, conversation.id, contact.id, ama.id, `Hello! I'd be happy to help 😊 Which size would you like? Thank you! ${i}`).then((m) => learning.learnFromMessage(t, m.id))));
    await Promise.all(Array.from({ length: 12 }, (_, i) => msg(t, conversation.id, contact.id, kofi.id, `Kindly send the size. Delivery is tomorrow. ${i}`).then((m) => learning.learnFromMessage(t, m.id))));

    const ctx = new DigitalSelfContextService(prisma as never, flagsOn as never);
    const admin = { id: ama.id, role: 'ADMIN' };
    await svc.assignToConversation(t, conversation.id, dsAma.id, admin);
    const amaBlock = await ctx.getStyleBlock(t, conversation.id);
    await svc.assignToConversation(t, conversation.id, dsKofi.id, admin);
    const kofiBlock = await ctx.getStyleBlock(t, conversation.id);
    expect(amaBlock).toMatch(/Energy: enthusiastic/);
    expect(kofiBlock).toMatch(/Register: formal/);
    expect(amaBlock).not.toEqual(kofiBlock);
    expect(await ctx.getStyleBlock(randomUUID(), conversation.id)).toBe(''); // wrong tenant

    await prisma.user.update({ where: { id: kofi.id }, data: { isActive: false } });
    expect(await ctx.getStyleBlock(t, conversation.id)).toBe('');
    await prisma.user.update({ where: { id: kofi.id }, data: { isActive: true } });
    await svc.setEnabled(t, dsKofi.id, false);
    expect(await ctx.getStyleBlock(t, conversation.id)).toBe('');
  });

  queueSuite('through a real BullMQ queue', () => {
    it('queues a human reply once, a worker learns from it, and a flag-off tenant queues nothing', async () => {
      const t = await tenant('queue');
      const ama = await user(t, 'ama');
      const { contact, conversation } = await convo(t);
      await svc.ensureForUser(t, ama.id);
      const m = await msg(t, conversation.id, contact.id, ama.id, 'Hello! Happy to help 😊 Which size?');

      const connection = { url: redisUrl! } as never;
      const name = `ds-learn-test-${tag}`;
      const queue = new Queue(name, { connection });
      const processor = new DigitalSelfLearningProcessor(learning, flagsOn as never);
      const worker = new Worker(name, (job) => processor.process(job), { connection });
      try {
        const trigger = new DigitalSelfLearningTrigger(flagsOn as never, queue as never);
        await Promise.all([trigger.enqueue(t, m.id), trigger.enqueue(t, m.id)]);
        expect((await queue.getJobs(['waiting', 'active', 'completed', 'delayed'])).length).toBe(1); // one deduplicated job

        for (let i = 0; i < 50; i++) {
          if ((await prisma.digitalSelf.findFirstOrThrow({ where: { tenantId: t } })).evidenceCount === 1) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const self = await prisma.digitalSelf.findFirstOrThrow({ where: { tenantId: t } });
        expect(self.evidenceCount).toBe(1);

        const off = new DigitalSelfLearningTrigger({ isEnabledCached: async () => false } as never, queue as never);
        const before = (await queue.getJobs(['waiting', 'active', 'completed', 'delayed'])).length;
        await off.enqueue(t, randomUUID());
        expect((await queue.getJobs(['waiting', 'active', 'completed', 'delayed'])).length).toBe(before);
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    }, 30_000);
  });
});
