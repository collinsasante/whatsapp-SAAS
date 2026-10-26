import { emptyTotals, LedgerRow, salesByProduct, summarize, summarizeByDate } from './revenue-summary.util';

const day = (d: string) => new Date(`${d}T12:00:00Z`);
const gmv = (orderId: string, amount: number, date = '2026-10-10'): LedgerRow =>
  ({ orderId, type: 'GMV', amountMajorUnits: amount, currency: 'GHS', createdAt: day(date), data: {} });
// The ledger stores the fee as a negative number.
const fee = (orderId: string, amount: number, date = '2026-10-10'): LedgerRow =>
  ({ orderId, type: 'TAKE_RATE', amountMajorUnits: -amount, currency: 'GHS', createdAt: day(date), data: {} });
// A refund entry's own amount is the negative of the fee given back; the refunded money is in data.
const refund = (orderId: string, refunded: number, feeBack: number, date = '2026-10-11'): LedgerRow => ({
  orderId, type: 'REFUND_ADJUSTMENT', amountMajorUnits: -feeBack, currency: 'GHS', createdAt: day(date),
  data: { refundAmountMajorUnits: refunded, takeRateClawbackMajorUnits: feeBack },
});

describe('summarize', () => {
  it('is all zeros with no entries', () => {
    expect(summarize([])).toEqual(emptyTotals());
    expect(emptyTotals().net).toBe(0);
  });

  it('keeps what is left after the platform fee on a plain sale', () => {
    const totals = summarize([gmv('o1', 100), fee('o1', 3)]);
    expect(totals).toMatchObject({ gross: 100, feeCharged: 3, platformFee: 3, refunded: 0, net: 97, paidOrders: 1, refunds: 0 });
  });

  it('subtracts the refunded money and gives back the fee on that refund', () => {
    // 100 sold, 3 fee. 40 refunded, 1.20 of the fee returned: keeps 100 - 40 - (3 - 1.2) = 58.2
    const totals = summarize([gmv('o1', 100), fee('o1', 3), refund('o1', 40, 1.2)]);
    expect(totals).toMatchObject({ gross: 100, refunded: 40, feeCharged: 3, feeReturned: 1.2, platformFee: 1.8, net: 58.2, refunds: 1 });
  });

  it('does not treat the negative refund entry amount as the refunded money', () => {
    const [entry] = [refund('o1', 40, 1.2)];
    expect(entry.amountMajorUnits).toBe(-1.2);
    expect(summarize([entry]).refunded).toBe(40);
  });

  it('counts an order once however many entries it has', () => {
    expect(summarize([gmv('o1', 10), fee('o1', 0.3), refund('o1', 2, 0.06), gmv('o2', 20), fee('o2', 0.6)]).paidOrders).toBe(2);
  });

  it('sums cents exactly with no floating-point drift', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => gmv(`o${i}`, 0.1));
    expect(summarize(rows).gross).toBe(100);
  });

  it('falls back to the entry amount for the fee returned when the data field is missing', () => {
    const legacy: LedgerRow = { orderId: 'o1', type: 'REFUND_ADJUSTMENT', amountMajorUnits: -0.5, currency: 'GHS', createdAt: day('2026-10-11'), data: null };
    expect(summarize([legacy])).toMatchObject({ feeReturned: 0.5, refunded: 0 });
  });
});

describe('summarizeByDate', () => {
  const dates = ['2026-10-10', '2026-10-11', '2026-10-12'];
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);

  it('returns a point for every date, zero where nothing happened', () => {
    const points = summarizeByDate([gmv('o1', 100), fee('o1', 3), refund('o1', 40, 1.2)], dates, dateOf);
    expect(points.map((p) => p.date)).toEqual(dates);
    expect(points[0]).toMatchObject({ gross: 100, net: 97 });
    expect(points[1]).toMatchObject({ gross: 0, refunded: 40, feeReturned: 1.2 });
    expect(points[2]).toMatchObject({ gross: 0, refunded: 0, net: 0 });
  });

  it('ignores entries outside the listed dates', () => {
    expect(summarizeByDate([gmv('o1', 100, '2026-09-01')], dates, dateOf).every((p) => p.gross === 0)).toBe(true);
  });
});

describe('salesByProduct', () => {
  it('groups lines by product, largest first, and reports how many were cut off', () => {
    const items = [
      { productName: 'Shea butter', quantity: 2, lineTotalMajorUnits: 40 },
      { productName: 'Soap', quantity: 1, lineTotalMajorUnits: 5 },
      { productName: 'Shea butter', quantity: 1, lineTotalMajorUnits: 20 },
      { productName: 'Oil', quantity: 3, lineTotalMajorUnits: 30 },
    ];
    const { top, otherProducts } = salesByProduct(items, 2);
    expect(top).toEqual([
      { productName: 'Shea butter', quantity: 3, sales: 60 },
      { productName: 'Oil', quantity: 3, sales: 30 },
    ]);
    expect(otherProducts).toBe(1);
  });
});
