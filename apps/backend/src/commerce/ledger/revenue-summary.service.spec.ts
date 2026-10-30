import { BadRequestException } from '@nestjs/common';
import { RevenueSummaryService } from './revenue-summary.service';

type Row = { orderId: string; type: 'GMV' | 'TAKE_RATE' | 'REFUND_ADJUSTMENT'; amountMajorUnits: number; currency: string; createdAt: Date; data: unknown };
const at = (iso: string) => new Date(iso);

function build(rows: Row[], items: Array<{ productNameSnapshot: string; quantity: number; lineTotalMajorUnits: number; order: { currency: string } }> = [], timezone = 'UTC') {
  const prisma = {
    tenantSettings: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    commerceLedgerEntry: { findMany: jest.fn().mockResolvedValue(rows) },
    orderItem: { findMany: jest.fn().mockResolvedValue(items) },
  };
  return { service: new RevenueSummaryService(prisma as never), prisma };
}

describe('RevenueSummaryService', () => {
  // Custom range 10-11 October; the equal period before it is 8-9 October.
  const query = { preset: 'custom' as const, from: '2026-10-10', to: '2026-10-11' };

  it('totals this period and the period before it separately', async () => {
    const { service } = build([
      { orderId: 'p1', type: 'GMV', amountMajorUnits: 50, currency: 'GHS', createdAt: at('2026-10-08T10:00:00Z'), data: {} },
      { orderId: 'p1', type: 'TAKE_RATE', amountMajorUnits: -1.5, currency: 'GHS', createdAt: at('2026-10-08T10:00:00Z'), data: {} },
      { orderId: 'c1', type: 'GMV', amountMajorUnits: 100, currency: 'GHS', createdAt: at('2026-10-10T10:00:00Z'), data: {} },
      { orderId: 'c1', type: 'TAKE_RATE', amountMajorUnits: -3, currency: 'GHS', createdAt: at('2026-10-10T10:00:00Z'), data: {} },
      { orderId: 'c1', type: 'REFUND_ADJUSTMENT', amountMajorUnits: -1.2, currency: 'GHS', createdAt: at('2026-10-11T09:00:00Z'), data: { refundAmountMajorUnits: 40, takeRateClawbackMajorUnits: 1.2 } },
    ]);
    const result = await service.getSummary('t1', query);
    expect(result.meta).toMatchObject({ from: '2026-10-10', to: '2026-10-11', previousFrom: '2026-10-08', previousTo: '2026-10-09', days: 2 });
    const [ghs] = result.currencies;
    expect(ghs.current).toMatchObject({ gross: 100, refunded: 40, platformFee: 1.8, net: 58.2, paidOrders: 1 });
    expect(ghs.previous).toMatchObject({ gross: 50, net: 48.5 });
    expect(ghs.series.map((p) => [p.date, p.gross, p.refunded])).toEqual([['2026-10-10', 100, 0], ['2026-10-11', 0, 40]]);
  });

  it('keeps currencies apart instead of adding them together', async () => {
    const { service } = build([
      { orderId: 'a', type: 'GMV', amountMajorUnits: 100, currency: 'GHS', createdAt: at('2026-10-10T10:00:00Z'), data: {} },
      { orderId: 'b', type: 'GMV', amountMajorUnits: 30, currency: 'USD', createdAt: at('2026-10-10T10:00:00Z'), data: {} },
    ]);
    const result = await service.getSummary('t1', query);
    expect(result.currencies.map((c) => [c.currency, c.current.gross])).toEqual([['GHS', 100], ['USD', 30]]);
  });

  it('scopes every query to the tenant and leaves out eval-harness orders', async () => {
    const { service, prisma } = build([]);
    await service.getSummary('tenant-a', query);
    expect(prisma.commerceLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a', order: { isEvalOrder: false } }),
    }));
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order: expect.objectContaining({ tenantId: 'tenant-a', isEvalOrder: false }) },
    }));
  });

  it('buckets entries into the workspace timezone day, not the UTC day', async () => {
    // 23:30 UTC on the 10th is already 05:00 on the 11th in India (UTC+5:30).
    const { service } = build([
      { orderId: 'a', type: 'GMV', amountMajorUnits: 10, currency: 'GHS', createdAt: at('2026-10-10T23:30:00Z'), data: {} },
    ], [], 'Asia/Kolkata');
    const [ghs] = (await service.getSummary('t1', query)).currencies;
    expect(ghs.series.find((p) => p.gross === 10)?.date).toBe('2026-10-11');
  });

  it('reports a currency that only sold in the previous period, with zero current figures', async () => {
    const { service } = build([{ orderId: 'a', type: 'GMV', amountMajorUnits: 20, currency: 'GHS', createdAt: at('2026-10-08T10:00:00Z'), data: {} }]);
    const [ghs] = (await service.getSummary('t1', query)).currencies;
    expect(ghs.current.gross).toBe(0);
    expect(ghs.previous.gross).toBe(20);
  });

  it('returns no currencies when nothing was sold', async () => {
    const { service } = build([]);
    expect((await service.getSummary('t1', query)).currencies).toEqual([]);
  });

  it('refuses a custom range that is missing a date or is backwards', async () => {
    const { service } = build([]);
    await expect(service.getSummary('t1', { preset: 'custom', from: '2026-10-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getSummary('t1', { preset: 'custom', from: '2026-10-12', to: '2026-10-10' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
