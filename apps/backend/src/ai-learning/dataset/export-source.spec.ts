import { PrismaExportSource, ReadOnlyClient } from './export-source';

function fakeClient(rows: unknown[] = []) {
  const calls: string[] = [];
  const findMany = jest.fn().mockImplementation(async () => { calls.push('findMany'); return rows; });
  const tx = {
    $executeRawUnsafe: jest.fn().mockImplementation(async (sql: string) => { calls.push(`sql:${sql}`); return 0; }),
    conversation: { findMany },
  };
  const client: ReadOnlyClient = { $transaction: async (fn) => fn(tx as never) };
  return { client, tx, findMany, calls };
}
const D = (s: number) => new Date(Date.UTC(2026, 9, 5, 10, 0, s));

describe('PrismaExportSource', () => {
  it('switches the transaction to READ ONLY before it reads anything', async () => {
    const { client, calls } = fakeClient();
    await new PrismaExportSource(client).readPage({ tenantId: 't1', from: D(0), to: D(100), after: null, take: 10 });
    expect(calls).toEqual(['sql:SET TRANSACTION READ ONLY', 'findMany']);
  });

  it('always filters by tenant and window, orders by (updatedAt, id) and takes only a page', async () => {
    const { client, findMany } = fakeClient();
    await new PrismaExportSource(client).readPage({ tenantId: 't1', from: D(0), to: D(100), after: null, take: 10 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('t1');
    expect(arg.where.AND[0]).toEqual({ updatedAt: { gte: D(0), lt: D(100) } });
    expect(arg.orderBy).toEqual([{ updatedAt: 'asc' }, { id: 'asc' }]);
    expect(arg.take).toBe(10);
  });

  it('resumes after a cursor with a keyset condition, not an offset', async () => {
    const { client, findMany } = fakeClient();
    await new PrismaExportSource(client).readPage({ tenantId: 't1', from: D(0), to: D(100), after: { updatedAt: D(50).toISOString(), id: 'c9' }, take: 5 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.AND[1]).toEqual({ OR: [{ updatedAt: { gt: D(50) } }, { updatedAt: D(50), id: { gt: 'c9' } }] });
    expect(arg).not.toHaveProperty('skip');
  });

  it('selects no credentials, tokens or contact details beyond what the builder needs', async () => {
    const { client, findMany } = fakeClient();
    await new PrismaExportSource(client).readPage({ tenantId: 't1', from: D(0), to: D(100), after: null, take: 1 });
    const select = JSON.stringify(findMany.mock.calls[0][0].select);
    expect(select).not.toMatch(/token|secret|password|email|avatar|externalId|customFields|mediaUrl|whatsappMessageId/i);
    expect(select).toMatch(/isEvalContact/);
  });

  it('maps rows to plain data and exposes no write method', async () => {
    const row = {
      id: 'c1', tenantId: 't1', updatedAt: D(1), createdAt: D(0), contact: { name: 'A', phone: '+1', isEvalContact: false },
      messages: [{ id: 'm1', direction: 'INBOUND', type: 'TEXT', content: 'hi', createdAt: D(0), metadata: null, deletedForEveryone: false, sender: null }],
      aiInteractionEvaluations: [{ status: 'EVALUATED', overallScore: 4, failureCategories: ['X'], needsHumanReview: false, customerCorrectionDetected: false, humanTakeoverFollowed: false }],
    };
    const { client } = fakeClient([row]);
    const source = new PrismaExportSource(client);
    const out = await source.readPage({ tenantId: 't1', from: D(0), to: D(100), after: null, take: 1 });
    expect(out[0]).toMatchObject({ id: 'c1', evaluations: [{ status: 'EVALUATED', failureCategories: ['X'] }], messages: [{ id: 'm1', type: 'TEXT' }] });
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(source)).sort()).toEqual(['constructor', 'readPage']);
  });
});
