import { MessagesService } from './messages.service';

function build(findFirstResults: Array<Record<string, unknown> | null>) {
  const findFirst = jest.fn();
  findFirstResults.forEach((r) => findFirst.mockResolvedValueOnce(r));
  findFirst.mockResolvedValue(null);
  const prisma = {
    message: { findFirst, update: jest.fn().mockResolvedValue({}) },
    campaignRecipient: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = Object.create(MessagesService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma, realtimeService: { emitMessageStatus: jest.fn() } });
  return { svc: svc as unknown as MessagesService, prisma };
}

describe('MessagesService.updateStatus -- receipts', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('applies a receipt that arrives before the provider id is saved (found on a retry)', async () => {
    const { svc, prisma } = build([null, null, { id: 'm1', status: 'SENT' }]);
    const p = svc.updateStatus('wamid.X', 'DELIVERED' as never, 't1');
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'DELIVERED' }) }));
    // every lookup is exact + tenant-scoped, so a receipt can never attach to another message
    for (const call of prisma.message.findFirst.mock.calls) expect(call[0]).toEqual({ where: { whatsappMessageId: 'wamid.X', tenantId: 't1' } });
  });

  it('gives up after the bounded retries for an id that never appears, without updating anything', async () => {
    const { svc, prisma } = build([]);
    const p = svc.updateStatus('wamid.NOPE', 'READ' as never, 't1');
    await jest.advanceTimersByTimeAsync(5000);
    await p;
    expect(prisma.message.findFirst).toHaveBeenCalledTimes(4);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('ignores a late DELIVERED after READ and a duplicate receipt', async () => {
    for (const [current, incoming] of [['READ', 'DELIVERED'], ['DELIVERED', 'DELIVERED']]) {
      const { svc, prisma } = build([{ id: 'm1', status: current }]);
      await svc.updateStatus('wamid.X', incoming as never, 't1');
      expect(prisma.message.update).not.toHaveBeenCalled();
    }
  });

  it('does not accept a receipt for another tenant', async () => {
    const { svc, prisma } = build([]);
    const p = svc.updateStatus('wamid.X', 'READ' as never, 'other-tenant');
    await jest.advanceTimersByTimeAsync(5000);
    await p;
    expect(prisma.message.findFirst.mock.calls.every((c) => c[0].where.tenantId === 'other-tenant')).toBe(true);
  });
});
