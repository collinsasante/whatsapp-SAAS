import { ConversationsService } from './conversations.service';

function build() {
  const prisma = {
    conversation: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    message: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = Object.create(ConversationsService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma });
  return { svc: svc as unknown as ConversationsService, prisma };
}
const whereOf = (prisma: ReturnType<typeof build>['prisma']) => prisma.conversation.findMany.mock.calls[0][0].where as Record<string, unknown> & { AND: Array<{ OR?: unknown[] }> };

describe('ConversationsService.findAll -- search', () => {
  it('is always scoped to the caller tenant, for the list and the count', async () => {
    const { svc, prisma } = build();
    await svc.findAll('tenant-A', 1, 25, undefined, undefined, 'jane');
    expect(whereOf(prisma).tenantId).toBe('tenant-A');
    expect(prisma.conversation.count.mock.calls[0][0].where.tenantId).toBe('tenant-A');
  });

  it('matches a formatted phone number by its digits as well as the raw text', async () => {
    const { svc, prisma } = build();
    await svc.findAll('t1', 1, 25, undefined, undefined, '+233 55-500');
    const or = whereOf(prisma).AND.find((c) => JSON.stringify(c.OR).includes('"contact"'))!.OR as Array<{ contact?: { phone?: { contains: string } } }>;
    const phones = or.filter((c) => c.contact?.phone).map((c) => c.contact!.phone!.contains);
    expect(phones).toEqual(['+233 55-500', '23355500']);
  });

  it('does not add a digits clause for text or very short numbers', async () => {
    const { svc, prisma } = build();
    await svc.findAll('t1', 1, 25, undefined, undefined, 'jane');
    const or = whereOf(prisma).AND.find((c) => JSON.stringify(c.OR).includes('"contact"'))!.OR as Array<{ contact?: { phone?: unknown } }>;
    expect(or.filter((c) => c.contact?.phone)).toHaveLength(1);
  });

  it('excludes resolved conversations by default and honors an explicit status', async () => {
    const a = build(); await a.svc.findAll('t1', 1, 25, undefined, undefined, 'x');
    expect(whereOf(a.prisma).status).toEqual({ notIn: ['RESOLVED'] });
    const b = build(); await b.svc.findAll('t1', 1, 25, 'RESOLVED' as never, undefined, 'x');
    expect(whereOf(b.prisma).status).toBe('RESOLVED');
  });
});
