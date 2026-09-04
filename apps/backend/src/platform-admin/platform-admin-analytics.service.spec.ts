import { PlatformAdminAnalyticsService } from './platform-admin-analytics.service';

function buildService(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    ...prismaOverrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new PlatformAdminAnalyticsService(prisma as any), prisma };
}

describe('PlatformAdminAnalyticsService.getCommerceAnalytics', () => {
  it('computes GMV/fees/refunds correctly from raw ledger entries (fees shown positive, stored negative)', async () => {
    const entries = [
      { createdAt: new Date('2026-09-01T10:00:00Z'), type: 'GMV', amountMajorUnits: 100 },
      { createdAt: new Date('2026-09-01T10:00:00Z'), type: 'TAKE_RATE', amountMajorUnits: -5 },
      { createdAt: new Date('2026-09-02T10:00:00Z'), type: 'GMV', amountMajorUnits: 50 },
      { createdAt: new Date('2026-09-02T10:00:00Z'), type: 'TAKE_RATE', amountMajorUnits: -2.5 },
      { createdAt: new Date('2026-09-02T10:00:00Z'), type: 'REFUND_ADJUSTMENT', amountMajorUnits: -20 },
    ];
    const { service, prisma } = buildService({
      commerceLedgerEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
        groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', type: 'GMV', _sum: { amountMajorUnits: 150 } }]),
      },
    });
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Tenant One' }]);

    const result = await service.getCommerceAnalytics('2026-09-01', '2026-09-02');

    expect(result.totals).toEqual({ gmv: 150, fees: 7.5, refunds: -20 });
    expect(result.daily).toEqual([
      { date: '2026-09-01', gmv: 100, fees: 5, refunds: 0 },
      { date: '2026-09-02', gmv: 50, fees: 2.5, refunds: -20 },
    ]);
    expect(result.topTenants).toEqual([{ tenantId: 't1', tenantName: 'Tenant One', gmv: 150 }]);
  });

  it('returns zeroed totals with no tenants when there are no ledger entries in range', async () => {
    const { service } = buildService({
      commerceLedgerEntry: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getCommerceAnalytics('2026-09-01', '2026-09-02');

    expect(result.totals).toEqual({ gmv: 0, fees: 0, refunds: 0 });
    expect(result.topTenants).toEqual([]);
  });
});

describe('PlatformAdminAnalyticsService.getCommerceFees', () => {
  it('flags orders with more than one GMV entry as duplicateGmvOrderIds', async () => {
    const { service } = buildService({
      commerceLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([
          { orderId: 'order-1', _count: { id: 1 } },
          { orderId: 'order-2', _count: { id: 2 } },
        ]),
      },
    });

    const result = await service.getCommerceFees('2026-09-01', '2026-09-02');

    expect(result.anomalies.duplicateGmvOrderIds).toEqual(['order-2']);
  });

  it('reports no anomalies when every order has exactly one GMV entry', async () => {
    const { service } = buildService({
      commerceLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([{ orderId: 'order-1', _count: { id: 1 } }]),
      },
    });

    const result = await service.getCommerceFees('2026-09-01', '2026-09-02');

    expect(result.anomalies.duplicateGmvOrderIds).toEqual([]);
  });
});

describe('PlatformAdminAnalyticsService.getAiCreditWallets', () => {
  it('computes purchased/bonus/consumed/refunded/adjusted per tenant from a single groupBy', async () => {
    const { service, prisma } = buildService({
      aiCreditTransaction: {
        groupBy: jest.fn().mockResolvedValue([
          { tenantId: 't1', type: 'PURCHASE', _sum: { credits: 1000 } },
          { tenantId: 't1', type: 'BONUS', _sum: { credits: 100 } },
          { tenantId: 't1', type: 'AI_USAGE', _sum: { credits: -300 } },
          { tenantId: 't1', type: 'REFUND', _sum: { credits: 50 } },
          { tenantId: 't1', type: 'ADJUSTMENT', _sum: { credits: -10 } },
        ]),
      },
    });
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Tenant One', aiCredits: 840 }]);
    prisma.tenant.count.mockResolvedValue(1);

    const result = await service.getAiCreditWallets({});

    expect(result.items).toEqual([{
      tenantId: 't1', tenantName: 'Tenant One', balance: 840,
      purchased: 1000, bonus: 100, consumed: 300, refunded: 50, adjusted: -10,
    }]);
  });

  it('skips the transaction groupBy entirely when the tenant page is empty', async () => {
    const groupBy = jest.fn();
    const { service } = buildService({ aiCreditTransaction: { groupBy } });

    const result = await service.getAiCreditWallets({});

    expect(groupBy).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });
});
