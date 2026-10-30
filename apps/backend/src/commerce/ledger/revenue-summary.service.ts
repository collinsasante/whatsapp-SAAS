import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { daysInRange, previousPeriod, resolveDateRange, resolvePreset } from '../../analytics/analytics.util';
import { enumerateTenantDates, getTenantDateRangeBoundaries, toTenantDateString } from '../../common/utils/timezone.util';
import { LedgerRow, RevenuePoint, RevenueTotals, ProductSales, salesByProduct, summarize, summarizeByDate } from './revenue-summary.util';
import type { RevenueRangeQueryDto } from './dto/revenue-query.dto';

const DEFAULT_TIMEZONE = 'Africa/Accra';
const PRODUCT_LIMIT = 8;
/** Beyond this the answer would have to be cut off, and a silently partial revenue figure is worse than an error. */
const MAX_ENTRIES = 100_000;

export interface CurrencyRevenue {
  currency: string;
  current: RevenueTotals;
  previous: RevenueTotals;
  series: RevenuePoint[];
  products: { top: ProductSales[]; otherProducts: number };
}

export interface RevenueSummary {
  meta: { from: string; to: string; previousFrom: string; previousTo: string; days: number; timezone: string; generatedAt: string };
  currencies: CurrencyRevenue[];
}

/**
 * The tenant's revenue for a period and the equal-length period before it. It uses the same ledger rows and the same
 * "real orders only" filter as the transaction list (eval-harness orders are excluded), so totals always agree with it.
 */
@Injectable()
export class RevenueSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string, query: RevenueRangeQueryDto): Promise<RevenueSummary> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;

    let range: { from: string; to: string };
    if (query.preset && query.preset !== 'custom') {
      range = resolvePreset(query.preset, timezone);
    } else if (query.preset === 'custom' || query.from || query.to) {
      if (!query.from || !query.to) throw new BadRequestException('A custom range needs both "from" and "to"');
      range = resolveDateRange(query.from, query.to, timezone);
    } else {
      range = resolvePreset('30d', timezone);
    }
    const prev = previousPeriod(range.from, range.to);
    const current = getTenantDateRangeBoundaries(range.from, range.to, timezone);
    const previous = getTenantDateRangeBoundaries(prev.from, prev.to, timezone);

    const rows = await this.prisma.commerceLedgerEntry.findMany({
      where: { tenantId, order: { isEvalOrder: false }, createdAt: { gte: previous.start, lt: current.end } },
      select: { orderId: true, type: true, amountMajorUnits: true, currency: true, createdAt: true, data: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_ENTRIES + 1,
    });
    if (rows.length > MAX_ENTRIES) throw new BadRequestException('There are too many transactions in this period to total. Choose a shorter period.');

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          tenantId, isEvalOrder: false,
          ledgerEntries: { some: { type: LedgerEntryType.GMV, createdAt: { gte: current.start, lt: current.end } } },
        },
      },
      select: { productNameSnapshot: true, quantity: true, lineTotalMajorUnits: true, order: { select: { currency: true } } },
    });

    const dates = enumerateTenantDates(range.from, range.to);
    const dateOf = (createdAt: Date) => toTenantDateString(createdAt, timezone);
    const byCurrency = new Map<string, { current: LedgerRow[]; previous: LedgerRow[] }>();
    for (const row of rows) {
      const bucket = byCurrency.get(row.currency) ?? { current: [], previous: [] };
      const ledgerRow: LedgerRow = { ...row, type: row.type };
      (row.createdAt >= current.start ? bucket.current : bucket.previous).push(ledgerRow);
      byCurrency.set(row.currency, bucket);
    }

    const currencies: CurrencyRevenue[] = [...byCurrency.entries()].map(([currency, bucket]) => ({
      currency,
      current: summarize(bucket.current),
      previous: summarize(bucket.previous),
      series: summarizeByDate(bucket.current, dates, dateOf),
      products: salesByProduct(
        items.filter((i) => i.order.currency === currency).map((i) => ({ productName: i.productNameSnapshot, quantity: i.quantity, lineTotalMajorUnits: i.lineTotalMajorUnits })),
        PRODUCT_LIMIT,
      ),
    })).sort((a, b) => b.current.gross - a.current.gross || a.currency.localeCompare(b.currency));

    return {
      meta: { ...range, previousFrom: prev.from, previousTo: prev.to, days: daysInRange(range.from, range.to), timezone, generatedAt: new Date().toISOString() },
      currencies,
    };
  }
}
