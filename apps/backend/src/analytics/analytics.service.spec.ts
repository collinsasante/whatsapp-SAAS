import { AnalyticsService } from './analytics.service';

function buildPrismaMock() {
  return {
    tenantSettings: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Africa/Accra' }) },
    whatsAppNumber: { findMany: jest.fn() },
    message: { groupBy: jest.fn() },
  };
}

function buildService() {
  const prisma = buildPrismaMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AnalyticsService(prisma as any);
  return { service, prisma };
}

describe('AnalyticsService.getChannelBreakdown', () => {
  const query = { from: '2026-09-01', to: '2026-09-16' };

  it('groups sent/received per WhatsApp number and buckets nulls as unattributed', async () => {
    const { service, prisma } = buildService();
    prisma.whatsAppNumber.findMany.mockResolvedValue([
      { id: 'num-1', label: 'Sales', isDefault: true, isActive: true },
      { id: 'num-2', label: 'Support', isDefault: false, isActive: true },
    ]);
    prisma.message.groupBy.mockResolvedValue([
      { whatsappNumberId: 'num-1', direction: 'OUTBOUND', _count: { id: 10 } },
      { whatsappNumberId: 'num-1', direction: 'INBOUND', _count: { id: 4 } },
      { whatsappNumberId: 'num-2', direction: 'OUTBOUND', _count: { id: 2 } },
      { whatsappNumberId: null, direction: 'INBOUND', _count: { id: 3 } },
    ]);

    const result = await service.getChannelBreakdown('t1', query as any);

    expect(result.channels).toEqual([
      { whatsappNumberId: 'num-1', label: 'Sales', isDefault: true, isActive: true, sent: 10, received: 4, total: 14 },
      { whatsappNumberId: 'num-2', label: 'Support', isDefault: false, isActive: true, sent: 2, received: 0, total: 2 },
    ]);
    expect(result.unattributed).toEqual({ sent: 0, received: 3, total: 3 });
  });

  it('returns zeroed counts for a number with no messages in range, and an empty unattributed bucket', async () => {
    const { service, prisma } = buildService();
    prisma.whatsAppNumber.findMany.mockResolvedValue([
      { id: 'num-1', label: 'Sales', isDefault: true, isActive: true },
    ]);
    prisma.message.groupBy.mockResolvedValue([]);

    const result = await service.getChannelBreakdown('t1', query as any);

    expect(result.channels).toEqual([
      { whatsappNumberId: 'num-1', label: 'Sales', isDefault: true, isActive: true, sent: 0, received: 0, total: 0 },
    ]);
    expect(result.unattributed).toEqual({ sent: 0, received: 0, total: 0 });
  });

  it('scopes the message groupBy query to the requested tenant and date range', async () => {
    const { service, prisma } = buildService();
    prisma.whatsAppNumber.findMany.mockResolvedValue([]);
    prisma.message.groupBy.mockResolvedValue([]);

    await service.getChannelBreakdown('tenant-xyz', query as any);

    expect(prisma.whatsAppNumber.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-xyz' },
    }));
    expect(prisma.message.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['whatsappNumberId', 'direction'],
      where: expect.objectContaining({ tenantId: 'tenant-xyz' }),
    }));
  });
});
