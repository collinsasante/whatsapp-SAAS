import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { CommerceLedgerService } from './commerce-ledger.service';
import { computeTakeRate } from './take-rate.util';

/**
 * Commerce revenue is the platform-admin-configured percentage (the "take rate"): per workspace in TenantSettings.takeRatePct, or the
 * platform default `default_commerce_fee_pct` for a workspace that has none. It is recorded once, as a negative TAKE_RATE ledger entry
 * when an order is paid. It is never added to what the customer pays. These tests pin that behaviour, and that Commerce needs neither
 * a monthly subscription nor an AI credit balance.
 */
type Entry = { orderId: string; type: string; amountMajorUnits: number; data?: Record<string, unknown> };

function build(opts: { tenantRate?: number | null; defaultRate?: number; status?: string; total?: number; existingTakeRate?: Entry | null; priorRefunds?: Entry[] } = {}) {
  const order = { id: 'order-1', tenantId: 't1', status: opts.status ?? 'PENDING_PAYMENT', totalMajorUnits: opts.total ?? 100, currency: 'GHS', conversationId: null };
  const created: Entry[] = [];
  const orderUpdates: Array<Record<string, unknown>> = [];
  const forbidden = (name: string) => new Proxy({}, { get: () => () => { throw new Error(`Commerce must not touch ${name}`); } });
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), findFirst: jest.fn().mockResolvedValue(order) },
    tenantSettings: { findUnique: jest.fn().mockResolvedValue(opts.tenantRate === undefined ? null : { takeRatePct: opts.tenantRate }) },
    platformSettings: { findUnique: jest.fn().mockResolvedValue(opts.defaultRate === undefined ? null : { value: opts.defaultRate }) },
    commerceLedgerEntry: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: { type: string } }) => (where.type === 'TAKE_RATE' ? (opts.existingTakeRate ?? null) : null)),
      findMany: jest.fn().mockResolvedValue(opts.priorRefunds ?? []),
    },
    // Commerce must work with no subscription and no AI credits: touching either fails the test.
    subscription: forbidden('subscriptions'),
    aiCreditTransaction: forbidden('AI credits'),
    tenant: forbidden('the tenant record (AI credit balance)'),
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      order: { update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { orderUpdates.push(data); return order; }) },
      commerceLedgerEntry: { create: jest.fn().mockImplementation(async ({ data }: { data: Entry }) => { created.push(data); return { id: `e${created.length}`, ...data }; }) },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    })),
  };
  const service = new CommerceLedgerService(prisma as never, {} as never, { markConverted: jest.fn() } as never, { findOne: jest.fn(), markReprocessed: jest.fn() } as never, { create: jest.fn().mockResolvedValue({ id: 'task' }) } as never);
  return { service, prisma, created, orderUpdates, order };
}

const takeRateEntries = (created: Entry[]) => created.filter((e) => e.type === 'TAKE_RATE');

describe('the admin-configured Commerce percentage on a paid order', () => {
  it('applies the workspace\'s configured percentage (5% is only an example) and records it once, as platform revenue out of the merchant\'s proceeds', async () => {
    const { service, created } = build({ tenantRate: 5, total: 200 });
    await service.recordPaymentSuccess('order-1', 'evt-1', 200, 'GHS');
    expect(created.find((e) => e.type === 'GMV')).toMatchObject({ amountMajorUnits: 200 });
    expect(takeRateEntries(created)).toEqual([expect.objectContaining({ amountMajorUnits: -10, data: { takeRatePct: 5, gmvAmount: 200 } })]);
  });

  it.each([0, 1, 2.5, 5, 7.5, 12, 100])('a configured percentage of %s produces exactly that share of the verified amount', async (pct) => {
    const { service, created } = build({ tenantRate: pct, total: 123.45 });
    await service.recordPaymentSuccess('order-1', 'evt-1', 123.45, 'GHS');
    expect(takeRateEntries(created)).toHaveLength(1);
    expect(takeRateEntries(created)[0].amountMajorUnits).toBe(-computeTakeRate(123.45, pct));
    expect(takeRateEntries(created)[0].data).toMatchObject({ takeRatePct: pct });
    expect(created.find((e) => e.type === 'GMV')!.amountMajorUnits).toBe(123.45);
  });

  it('a workspace with no percentage of its own uses the platform default set by the admin', async () => {
    const { service, created } = build({ tenantRate: null, defaultRate: 3, total: 100 });
    await service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(takeRateEntries(created)[0]).toMatchObject({ amountMajorUnits: -3, data: { takeRatePct: 3 } });
  });

  it('an explicit workspace percentage wins over the default, including an explicit 0%', async () => {
    const withTen = build({ tenantRate: 10, defaultRate: 3, total: 100 });
    await withTen.service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(takeRateEntries(withTen.created)[0].amountMajorUnits).toBe(-10);

    const zero = build({ tenantRate: 0, defaultRate: 3, total: 100 });
    await zero.service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(takeRateEntries(zero.created)[0].amountMajorUnits).toBe(-0);
  });

  it('with no workspace percentage and no default, the percentage is 0: nothing is taken and nothing is invented', async () => {
    const { service, created } = build({ tenantRate: null });
    await service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(takeRateEntries(created)[0].amountMajorUnits).toBe(-0);
  });

  it('a changed percentage affects only the NEXT payments: each payment records the rate it was charged at', async () => {
    const first = build({ tenantRate: 5, total: 100 });
    await first.service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    const second = build({ tenantRate: 8, total: 100 });
    await second.service.recordPaymentSuccess('order-1', 'evt-2', 100, 'GHS');
    expect(takeRateEntries(first.created)[0].data).toMatchObject({ takeRatePct: 5 });
    expect(takeRateEntries(second.created)[0].data).toMatchObject({ takeRatePct: 8 });
  });
});

describe('the percentage is never applied twice, and never added to the customer\'s total', () => {
  it('exactly one TAKE_RATE entry per paid order, and the order\'s own total is not rewritten', async () => {
    const { service, created, orderUpdates } = build({ tenantRate: 5, total: 100 });
    await service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(takeRateEntries(created)).toHaveLength(1);
    expect(orderUpdates).toHaveLength(1);
    expect(Object.keys(orderUpdates[0]).sort()).toEqual(['paidAt', 'status']);
  });

  it('a repeated webhook for the same payment adds nothing', async () => {
    const { service, prisma, created } = build({ tenantRate: 5, status: 'PAID' });
    prisma.commerceLedgerEntry.findFirst.mockResolvedValue({ id: 'existing', type: 'GMV' });
    await service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS');
    expect(created).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a second, different payment event for an already-paid order is ignored rather than taking the percentage again', async () => {
    const { service, prisma, created } = build({ tenantRate: 5, status: 'PAID' });
    prisma.commerceLedgerEntry.findFirst.mockResolvedValue(null);
    expect(await service.recordPaymentSuccess('order-1', 'evt-2', 100, 'GHS')).toBeNull();
    expect(created).toHaveLength(0);
  });
});

describe('Commerce needs no monthly subscription and no AI credits', () => {
  it('takes payment, records GMV and the percentage without reading a subscription, the AI credit balance or any credit transaction', async () => {
    // build() makes subscription, aiCreditTransaction and tenant throw if touched.
    const { service, created } = build({ tenantRate: 5 });
    await expect(service.recordPaymentSuccess('order-1', 'evt-1', 100, 'GHS')).resolves.toBeTruthy();
    expect(created.map((e) => e.type)).toEqual(['GMV', 'TAKE_RATE']);
  });

  it('refunds likewise need neither', async () => {
    const { service, created } = build({ status: 'PAID', total: 100, existingTakeRate: { orderId: 'order-1', type: 'TAKE_RATE', amountMajorUnits: -5, data: { takeRatePct: 5 } } });
    await expect(service.recordRefund('order-1', 40)).resolves.toBeTruthy();
    expect(created.map((e) => e.type)).toEqual(['REFUND_ADJUSTMENT']);
  });

  it('the Commerce core (orders, products, checkout, ledger, webhooks) never reads a subscription, a plan or the AI credit balance', () => {
    const root = join(__dirname, '..');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
    const core = ['orders', 'products', 'public-checkout', 'ledger', 'webhooks'].flatMap((d) => files(join(root, d)));
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may mention these words
    const offenders = core.filter((f) => /\bsubscription\b|SubscriptionStatus|\bplan\b|aiCredits|AiCredit|InsufficientAiCredits/i.test(code(f))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});

describe('refunds reverse what the order actually earned, whatever the percentage is now', () => {
  const earned = (pct: number): Entry => ({ orderId: 'order-1', type: 'TAKE_RATE', amountMajorUnits: -pct, data: { takeRatePct: pct, gmvAmount: 100 } });

  it('uses the percentage recorded when the order was paid, even after the admin changed it', async () => {
    const { service, created } = build({ status: 'PAID', total: 100, tenantRate: 10, existingTakeRate: earned(5) });
    await service.recordRefund('order-1', 50);
    expect(created).toEqual([expect.objectContaining({ type: 'REFUND_ADJUSTMENT', amountMajorUnits: -2.5 })]); // 5% of 50, not the new 10%
  });

  it('a full refund gives back exactly what was earned', async () => {
    const { service, created } = build({ status: 'PAID', total: 100, tenantRate: 10, existingTakeRate: earned(5) });
    await service.recordRefund('order-1', 100);
    expect(created[0].amountMajorUnits).toBe(-5);
  });

  it('an order with no recorded percentage falls back to the current one', async () => {
    const { service, created } = build({ status: 'PAID', total: 100, tenantRate: 10, existingTakeRate: null });
    await service.recordRefund('order-1', 50);
    expect(created[0].amountMajorUnits).toBe(-5);
  });

  it('only adds a REFUND_ADJUSTMENT: the original GMV and TAKE_RATE entries and the order total are never rewritten', async () => {
    const { service, created, orderUpdates } = build({ status: 'PAID', total: 100, existingTakeRate: earned(5) });
    await service.recordRefund('order-1', 100);
    expect(created.map((e) => e.type)).toEqual(['REFUND_ADJUSTMENT']);
    expect(orderUpdates).toEqual([{ status: 'REFUNDED' }]);
  });
});

describe('one source for the percentage', () => {
  const src = join(__dirname, '..', '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
  const all = files(src);
  const using = (re: RegExp) => all.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f)).sort();

  it('only the ledger applies it (computeTakeRate), so there is no second calculation to double-count', () => {
    expect(using(/computeTakeRate\(|computeRefundAdjustment\(/)).toEqual(['commerce/ledger/commerce-ledger.service.ts', 'commerce/ledger/take-rate.util.ts']);
  });

  it('the percentage lives only in TenantSettings.takeRatePct and the platform default_commerce_fee_pct setting', () => {
    expect(using(/default_commerce_fee_pct/)).toEqual(expect.arrayContaining(['commerce/ledger/commerce-ledger.service.ts', 'platform-admin/platform-admin.service.ts']));
    expect(using(/\btakeRatePct\b/).filter((f) => !/^(commerce\/ledger|platform-admin)\//.test(f))).toEqual([]);
  });

  it('customer-facing prices and order totals never include it: orders and checkout do not mention a fee or the percentage', () => {
    const offenders = all.filter((f) => /commerce\/(orders|public-checkout|products)\//.test(f)).filter((f) => /takeRate|default_commerce_fee|feePct|markup/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(src, f))).toEqual([]);
  });
});
