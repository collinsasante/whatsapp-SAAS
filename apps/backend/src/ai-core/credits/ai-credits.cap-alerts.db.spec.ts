/**
 * Spend-cap alerts, thresholds, reset visibility and tenant isolation against a REAL PostgreSQL. Skipped unless CAPALERT_TEST_DATABASE_URL is set (name must
 * contain test/scratch/tmp), its own scratch database (it truncates tables, so it cannot share one with another spec):
 *   CAPALERT_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/spendcap_test npx jest src/ai-core/credits/ai-credits.cap-alerts.db.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { AiCreditsService } from './ai-credits.service';
import { AiCapAlertNotifier, capStateFor } from './ai-cap-alerts';
import { NotificationsService } from '../../notifications/notifications.service';

const url = process.env['CAPALERT_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('CAPALERT_TEST_DATABASE_URL must name a throwaway database.');
const describeDb = url ? describe : describe.skip;

const T = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const quote = { reservedCredits: 10, maxCreditsPerAttempt: 10, creditsPerUsd: 100, inputPerMTokUsd: 1, outputPerMTokUsd: 1 };

describe('capStateFor (pure)', () => {
  it.each([
    [0, null, undefined, 'NO_CAP'], [0, 100, undefined, 'OK'], [79, 100, undefined, 'OK'], [80, 100, undefined, 'WARNING'], [99, 100, undefined, 'WARNING'],
    [100, 100, undefined, 'REACHED'], [150, 100, undefined, 'REACHED'], [49, 100, 50, 'OK'], [50, 100, 50, 'WARNING'], [0, 0, undefined, 'REACHED'],
  ] as const)('used %s of %s (warn %s) -> %s', (used, cap, warn, want) => expect(capStateFor(used, cap, warn)).toBe(want));
});

describeDb('AI spend-cap alerts (real database)', () => {
  const mk = () => new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const pA = mk(); const pB = mk();
  const pricing = { getReservationQuote: async () => quote };
  const delivered: Array<{ tenantId: string; level: string; used: number; cap: number }> = [];
  let failNext = 0;
  const sink = { deliver: async (tenantId: string, a: { level: string; used: number; cap: number }) => { if (failNext > 0) { failNext--; throw new Error('smtp down'); } delivered.push({ tenantId, level: a.level, used: a.used, cap: a.cap }); return 1; } };
  const A = new AiCreditsService(pA as never, pricing as never, sink as unknown as AiCapAlertNotifier);
  const B = new AiCreditsService(pB as never, pricing as never, sink as unknown as AiCapAlertNotifier);
  let n = 0;

  async function reset(opts: { cap?: number | null; warn?: number | null; timezone?: string } = {}) {
    delivered.length = 0; failNext = 0;
    await pA.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    for (const [i, id] of [T, T2].entries()) {
      await pA.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, ai_credits, updated_at) VALUES ($1,$2,$3,100000,now())`, id, `T${i}`, `v${i}`);
      await pA.$executeRawUnsafe(`INSERT INTO tenant_settings (id, tenant_id, timezone, ai_daily_credit_cap, ai_cap_warn_percent, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
        `00000000-0000-4000-8000-0000000000a${i}`, id, opts.timezone ?? 'UTC', opts.cap ?? null, opts.warn ?? null);
    }
  }
  async function usage(tenantId: string, credits: number, type: 'AI_USAGE' | 'REFUND' = 'AI_USAGE') {
    await pA.$executeRawUnsafe(`INSERT INTO ai_credit_transactions (id, tenant_id, type, credits, balance_after, description, created_at) VALUES ($1,$2,$3::"AiCreditTransactionType",$4,0,'t',now())`,
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tenantId, type, credits);
  }
  const alerts = (tenantId = T) => pA.aiCapAlert.findMany({ where: { tenantId }, orderBy: { level: 'asc' } });
  afterAll(async () => { await pA.$disconnect(); await pB.$disconnect(); });

  it('stays silent below the warning threshold and for a workspace with no cap', async () => {
    await reset({ cap: 100 });
    await A.reserveFixedCredits(T, 10);                      // 10%
    await A.reserveFixedCredits(T, 60);                      // 70%
    expect(delivered).toEqual([]);
    await pA.$executeRawUnsafe('UPDATE tenant_settings SET ai_daily_credit_cap = NULL WHERE tenant_id = $1', T2);
    await A.reserveFixedCredits(T2, 5000);
    expect(delivered).toEqual([]);
  });

  it('warns once at the threshold, once more when the cap is reached, and never repeats within the day', async () => {
    await reset({ cap: 100 });
    await A.reserveFixedCredits(T, 80);                      // 80% -> WARNING
    await A.reserveFixedCredits(T, 10);                      // 90%: still the same warning
    await A.reserveFixedCredits(T, 10);                      // 100% -> REACHED
    await expect(A.reserveFixedCredits(T, 1)).rejects.toThrow(/cap reached/);   // rejection must not announce again
    await expect(A.reserveFixedCredits(T, 1)).rejects.toThrow(/cap reached/);
    expect(delivered.map((d) => [d.level, d.used])).toEqual([['WARNING', 80], ['REACHED', 100]]);
    expect((await alerts()).map((a) => [a.level, a.deliveredAt !== null])).toEqual([['REACHED', true], ['WARNING', true]]);
  });

  it('announces a cap that is already exhausted when the first rejected request arrives', async () => {
    await reset({ cap: 20 }); await usage(T, -20);
    await expect(A.reserveFixedCredits(T, 5)).rejects.toThrow(/cap reached/);
    expect(delivered).toEqual([{ tenantId: T, level: 'REACHED', used: 20, cap: 20 }]);
  });

  it('honours a custom warning percentage', async () => {
    await reset({ cap: 100, warn: 50 });
    await A.reserveFixedCredits(T, 40); expect(delivered).toEqual([]);
    await A.reserveFixedCredits(T, 10); expect(delivered.map((d) => d.level)).toEqual(['WARNING']);
  });

  it('CONCURRENCY: 40 simultaneous reservations over two connections never exceed the cap and announce each threshold exactly once', async () => {
    await reset({ cap: 100 });
    const r = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => (i % 2 ? A : B).reserveFixedCredits(T, 10)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(10);                      // 10 x 10 = exactly the cap
    expect(await pA.aiCreditReservation.count({ where: { tenantId: T } })).toBe(10);
    expect(delivered.filter((d) => d.level === 'WARNING')).toHaveLength(1);
    expect(delivered.filter((d) => d.level === 'REACHED')).toHaveLength(1);
    expect(await pA.aiCapAlert.count({ where: { tenantId: T } })).toBe(2);
  });

  it('a delivery failure is retried by the next reservation, and never blocks or fails the reservation', async () => {
    await reset({ cap: 100 });
    failNext = 1;
    await expect(A.reserveFixedCredits(T, 85)).resolves.toBeDefined();                       // alert fails, reservation still succeeds
    expect(delivered).toEqual([]);
    expect((await alerts())[0]!.deliveredAt).toBeNull();                                      // claim given back
    await A.reserveFixedCredits(T, 1);                                                        // retry
    expect(delivered.map((d) => d.level)).toEqual(['WARNING']);
    expect((await alerts())[0]!.deliveredAt).not.toBeNull();
  });

  it('announces again on a new local day, and keys the day by the workspace timezone', async () => {
    await reset({ cap: 100, timezone: 'Pacific/Kiritimati' });                                // UTC+14: its date differs from UTC for hours each day
    await A.reserveFixedCredits(T, 85);
    const [row] = await alerts();
    const [{ d }] = await pA.$queryRawUnsafe<Array<{ d: string }>>(`SELECT to_char(now() AT TIME ZONE 'Pacific/Kiritimati', 'YYYY-MM-DD') AS d`);
    expect(row!.dayKey).toBe(d);
    await pA.$executeRawUnsafe(`UPDATE ai_cap_alerts SET day_key = '2000-01-01' WHERE tenant_id = $1`, T);   // pretend that was an earlier day
    await usage(T, 0);
    await A.reserveFixedCredits(T, 1);
    expect(delivered.filter((d2) => d2.level === 'WARNING')).toHaveLength(2);
  });

  it('refunds lower the spend: the summary and state recover', async () => {
    await reset({ cap: 100 });
    await usage(T, -90);
    expect((await A.getUsageSummary(T)).capState).toBe('WARNING');
    await usage(T, 50, 'REFUND');
    const s = await A.getUsageSummary(T);
    expect(s).toMatchObject({ spentToday: 40, capState: 'OK', dailyCreditCap: 100, percentOfCapUsed: 40, capWarnPercent: 80, capTimezone: 'UTC' });
  });

  it('shows when the cap resets: the next local midnight, in the future and at most 24h away', async () => {
    await reset({ cap: 100, timezone: 'America/New_York' });
    const s = await A.getUsageSummary(T);
    const ms = new Date(s.capResetsAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(0); expect(ms).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
    const [{ ok }] = await pA.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT (($1::timestamptz AT TIME ZONE 'America/New_York')::time = '00:00') AS ok`, s.capResetsAt);
    expect(ok).toBe(true);
    expect(s.capTimezone).toBe('America/New_York');
  });

  it('counts open reservations in the summary and state', async () => {
    await reset({ cap: 100 });
    await A.reserveFixedCredits(T, 70); await A.reserveFixedCredits(T, 15);
    expect(await A.getUsageSummary(T)).toMatchObject({ spentToday: 0, heldNow: 85, capState: 'WARNING', percentOfCapUsed: 85 });
  });

  it('TENANT ISOLATION: one workspace\'s usage, alerts and summary never include another\'s', async () => {
    await reset({ cap: 100 });
    await A.reserveFixedCredits(T, 90);                                                       // T is near its cap
    expect(await A.getUsageSummary(T2)).toMatchObject({ heldNow: 0, spentToday: 0, capState: 'OK' });
    expect(delivered.every((d) => d.tenantId === T)).toBe(true);
    expect(await alerts(T2)).toEqual([]);
    await A.reserveFixedCredits(T2, 10);                                                      // T2 is unaffected by T being near its cap
    expect(delivered.filter((d) => d.tenantId === T2)).toEqual([]);
    const overview = await A.getCapOverview();
    expect(overview.map((o) => o.tenantId).sort()).toEqual([T, T2].sort());
  });

  it('delivers real notifications to the workspace\'s ADMIN users only, in their own workspace', async () => {
    await reset({ cap: 100 });
    const user = (tenantId: string, role: 'ADMIN' | 'AGENT', email: string, isActive = true) => pA.user.create({ data: { tenantId, name: email, email, passwordHash: 'x', role, isActive } });
    const [admin, agent] = [await user(T, 'ADMIN', 'a@t.test'), await user(T, 'AGENT', 'g@t.test')];
    await user(T, 'ADMIN', 'off@t.test', false);
    const other = await user(T2, 'ADMIN', 'o@t.test');
    const emitted: string[] = [];
    const notifications = new NotificationsService(pA as never, { emitToUser: (id: string) => emitted.push(id) } as never, { getTokensForUser: async () => [] } as never, {} as never);
    const real = new AiCreditsService(pA as never, pricing as never, new AiCapAlertNotifier(pA as never, notifications));
    await real.reserveFixedCredits(T, 85);
    const rows = await pA.notification.findMany({ where: {} });
    expect(rows.map((r) => r.userId)).toEqual([admin.id]);
    expect(rows[0]).toMatchObject({ tenantId: T, type: 'SYSTEM', link: '/billing' });
    expect(rows[0]!.title).toMatch(/80%/);
    expect(rows[0]!.body).toMatch(/85 of 100 credits/);
    expect(emitted).toEqual([admin.id]);
    expect(rows.some((r) => r.userId === agent.id || r.userId === other.id)).toBe(false);
  });
});
