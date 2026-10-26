/**
 * Revenue figures for the Revenue page, computed from ledger entries.
 *
 * What the ledger records (see CommerceLedgerService):
 *  - GMV:               amountMajorUnits = the verified amount a customer paid (positive).
 *  - TAKE_RATE:         amountMajorUnits = the platform fee, stored NEGATIVE.
 *  - REFUND_ADJUSTMENT: amountMajorUnits is the NEGATIVE of the fee given back on a refund. The money actually
 *                       refunded to the customer is only in data.refundAmountMajorUnits.
 *
 * Because the sign of a refund entry says nothing about how much was refunded, nothing here relies on signs for
 * refunds: refunded money and fee returned are read from the entry's own `data` fields. Money is summed in whole
 * minor units (cents/pesewas) so a long list of entries never accumulates floating-point error.
 *
 * Definitions shown to the user:
 *   Gross sales   = sum of GMV entries
 *   Refunded      = sum of refunded amounts
 *   Platform fee  = sum of fees charged, minus the fee returned on refunds
 *   You keep      = Gross sales - Refunded - Platform fee
 */

export type LedgerEntryKind = 'GMV' | 'TAKE_RATE' | 'REFUND_ADJUSTMENT';

export interface LedgerRow {
  orderId: string;
  type: LedgerEntryKind;
  amountMajorUnits: number;
  currency: string;
  createdAt: Date;
  data: unknown;
}

export interface RevenueTotals {
  gross: number;
  refunded: number;
  feeCharged: number;
  feeReturned: number;
  /** feeCharged - feeReturned: the fee actually kept by the platform. */
  platformFee: number;
  net: number;
  paidOrders: number;
  refunds: number;
}

export interface RevenuePoint extends RevenueTotals {
  date: string;
}

const toMinor = (major: number): number => Math.round((Number.isFinite(major) ? major : 0) * 100);
const toMajor = (minor: number): number => minor / 100;

function numberField(data: unknown, key: string): number | null {
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface Accumulator {
  gross: number;
  refunded: number;
  feeCharged: number;
  feeReturned: number;
  orders: Set<string>;
  refunds: number;
}

const emptyAccumulator = (): Accumulator => ({ gross: 0, refunded: 0, feeCharged: 0, feeReturned: 0, orders: new Set(), refunds: 0 });

function add(acc: Accumulator, row: LedgerRow): void {
  if (row.type === 'GMV') {
    acc.gross += toMinor(row.amountMajorUnits);
    acc.orders.add(row.orderId);
  } else if (row.type === 'TAKE_RATE') {
    acc.feeCharged += Math.abs(toMinor(row.amountMajorUnits));
  } else if (row.type === 'REFUND_ADJUSTMENT') {
    acc.refunds += 1;
    acc.refunded += Math.abs(toMinor(numberField(row.data, 'refundAmountMajorUnits') ?? 0));
    acc.feeReturned += Math.abs(toMinor(numberField(row.data, 'takeRateClawbackMajorUnits') ?? Math.abs(row.amountMajorUnits)));
  }
}

function finish(acc: Accumulator): RevenueTotals {
  const platformFee = acc.feeCharged - acc.feeReturned;
  return {
    gross: toMajor(acc.gross),
    refunded: toMajor(acc.refunded),
    feeCharged: toMajor(acc.feeCharged),
    feeReturned: toMajor(acc.feeReturned),
    platformFee: toMajor(platformFee),
    net: toMajor(acc.gross - acc.refunded - platformFee),
    paidOrders: acc.orders.size,
    refunds: acc.refunds,
  };
}

export function emptyTotals(): RevenueTotals {
  return finish(emptyAccumulator());
}

export function summarize(rows: LedgerRow[]): RevenueTotals {
  const acc = emptyAccumulator();
  for (const row of rows) add(acc, row);
  return finish(acc);
}

/** One point per date in `dates` (a date with no entries is a zero point, so the chart has no gaps). */
export function summarizeByDate(rows: LedgerRow[], dates: string[], dateOf: (createdAt: Date) => string): RevenuePoint[] {
  const buckets = new Map<string, Accumulator>(dates.map((d) => [d, emptyAccumulator()]));
  for (const row of rows) {
    const bucket = buckets.get(dateOf(row.createdAt));
    if (bucket) add(bucket, row);
  }
  return dates.map((date) => ({ date, ...finish(buckets.get(date)!) }));
}

export interface SoldItemRow {
  productName: string;
  quantity: number;
  lineTotalMajorUnits: number;
}

export interface ProductSales {
  productName: string;
  quantity: number;
  sales: number;
}

/** Sales by product, before refunds (refunds are recorded per order, not per line). Largest first, capped at `limit`. */
export function salesByProduct(items: SoldItemRow[], limit: number): { top: ProductSales[]; otherProducts: number } {
  const byName = new Map<string, { quantity: number; sales: number }>();
  for (const item of items) {
    const entry = byName.get(item.productName) ?? { quantity: 0, sales: 0 };
    entry.quantity += item.quantity;
    entry.sales += toMinor(item.lineTotalMajorUnits);
    byName.set(item.productName, entry);
  }
  const all = [...byName.entries()]
    .map(([productName, v]) => ({ productName, quantity: v.quantity, sales: toMajor(v.sales) }))
    .sort((a, b) => b.sales - a.sales || a.productName.localeCompare(b.productName));
  return { top: all.slice(0, limit), otherProducts: Math.max(all.length - limit, 0) };
}
