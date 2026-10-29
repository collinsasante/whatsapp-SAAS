import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { runExport } from '../src/ai-learning/dataset/conversation-export.service';
import { PrismaExportSource } from '../src/ai-learning/dataset/export-source';

/**
 * The conversation export against a REAL PostgreSQL: the actual Prisma query, the READ ONLY transaction, tenant scope and keyset paging.
 *
 * SAFETY: runs ONLY when AI_LEARNING_PG_TESTS=1, DATABASE_URL is on localhost and the database name contains "test". It creates its own
 * tenants and deletes only those. Never prints the connection string. No provider is involved.
 */
function disposableDatabaseConfigured(): boolean {
  if (process.env.AI_LEARNING_PG_TESTS !== '1') return false;
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const p = new URL(url);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(p.hostname) && /test/i.test(decodeURIComponent(p.pathname.replace(/^\//, '')));
  } catch { return false; }
}
const suite = disposableDatabaseConfigured() ? describe : describe.skip;
const KEY = 'k'.repeat(40);

suite('conversation export (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const tenantIds: string[] = [];
  let outDir: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  });
  beforeEach(() => { outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-e2e-')); });
  afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

  async function seedTenant(label: string) {
    const tenant = await prisma.tenant.create({ data: { name: `export-e2e ${label} ${randomUUID().slice(0, 6)}`, webhookVerifyToken: randomUUID() } });
    tenantIds.push(tenant.id);
    const agent = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Esi Owusu', email: `e-${randomUUID()}@example.com`, passwordHash: 'x', role: 'AGENT', isActive: true } });
    const aiUser = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Verz', email: `ai-${randomUUID()}@example.com`, passwordHash: 'x', role: 'AGENT', isActive: true, isAiAgent: true } });
    return { tenant, agent, aiUser };
  }
  async function seedConversation(t: { tenant: { id: string }; agent: { id: string }; aiUser: { id: string } }, phone: string, secret: string, opts: { simulated?: boolean } = {}) {
    const contact = await prisma.contact.create({ data: { tenantId: t.tenant.id, phone, name: 'Kofi Mensah' } });
    const conv = await prisma.conversation.create({ data: { tenantId: t.tenant.id, contactId: contact.id, status: 'OPEN' } });
    const base = Date.now() - 3600_000;
    const mk = (i: number, direction: 'INBOUND' | 'OUTBOUND', content: string, senderId?: string) => prisma.message.create({
      data: { tenantId: t.tenant.id, conversationId: conv.id, contactId: contact.id, direction, type: 'TEXT', status: 'DELIVERED', content, senderId, createdAt: new Date(base + i * 1000), metadata: opts.simulated ? { simulated: true } : undefined },
    });
    await mk(0, 'INBOUND', `Hello I am Kofi, my number is ${secret}`);
    await mk(1, 'OUTBOUND', 'Hello, how can I help?', t.aiUser.id);
    await mk(2, 'INBOUND', 'What is delivery to Kumasi?');
    await mk(3, 'OUTBOUND', 'It is GHS 45. Mail esi@shop.com', t.agent.id);
    return conv;
  }
  const window = () => ({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
  const opts = (tenantId: string, over: object = {}) => ({ tenantId, ...window(), limit: 100, pageSize: 2, mode: 'dry-run' as const, pseudonymKey: KEY, exportId: 'exp_e2e', ...over });

  it('exports only the requested tenant, as roles, redacted, with the Test Chat conversation excluded', async () => {
    const a = await seedTenant('A');
    const b = await seedTenant('B');
    await seedConversation(a, '+233241111111', '0241111111');
    await seedConversation(a, '+233242222222', '0242222222');
    await seedConversation(a, simulatedPhoneFor('u1'), '0243333333', { simulated: true });
    await seedConversation(b, '+233244444444', '0244444444');

    const report = await runExport(new PrismaExportSource(prisma), opts(a.tenant.id, { mode: 'write', outDir: path.join(outDir, 'o'), approvalId: 'APPR-E2E-1' }));
    expect(report).toMatchObject({ examined: 3, exported: 2, complete: true });
    expect(report.excluded.simulated).toBe(1);
    expect(report.roles).toEqual({ customer: 4, ai: 2, human_agent: 2, system: 0 });
    expect(report.byStratum).toEqual({ ai_then_human: 2 });
    const data = fs.readFileSync(path.join(outDir, 'o', 'data.jsonl'), 'utf8');
    expect(data).not.toMatch(/0241111111|0242222222|0244444444|Kofi|Mensah|Esi|Owusu|esi@shop|@/);
    expect(data).toMatch(/\[PHONE\]/);
    expect(data).toMatch(/\[EMAIL\]/);
    expect(data).not.toContain(a.tenant.id);
    expect(data).not.toContain(b.tenant.id);
    expect(JSON.stringify(report)).not.toContain(a.tenant.id);
  });

  it('pages with a keyset cursor: small pages see every conversation exactly once', async () => {
    const t = await seedTenant('P');
    for (let i = 0; i < 5; i++) await seedConversation(t, `+23324000000${i}`, `024000000${i}`);
    const report = await runExport(new PrismaExportSource(prisma), opts(t.tenant.id, { pageSize: 2 }));
    expect(report.examined).toBe(5);
    expect(report.exported).toBe(5);
    expect(report.excluded.duplicate).toBe(0);
  });

  it('the transaction is READ ONLY: a write attempted inside it is rejected by the database', async () => {
    const t = await seedTenant('RO');
    const before = await prisma.tenant.count({ where: { id: t.tenant.id } });
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.tenant.update({ where: { id: t.tenant.id }, data: { name: 'changed' } });
    })).rejects.toThrow(/read-only/i);
    expect(await prisma.tenant.count({ where: { id: t.tenant.id } })).toBe(before);
    const row = await prisma.tenant.findUnique({ where: { id: t.tenant.id }, select: { name: true } });
    expect(row?.name).not.toBe('changed');
  });

  it('an export does not change any row it reads', async () => {
    const t = await seedTenant('NC');
    const conv = await seedConversation(t, '+233245555555', '0245555555');
    const before = await prisma.conversation.findUnique({ where: { id: conv.id }, select: { updatedAt: true, status: true } });
    await runExport(new PrismaExportSource(prisma), opts(t.tenant.id));
    expect(await prisma.conversation.findUnique({ where: { id: conv.id }, select: { updatedAt: true, status: true } })).toEqual(before);
  });
});
