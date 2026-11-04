/**
 * Per-workspace daily AI spend cap against a REAL PostgreSQL (the cap is enforced inside the reservation transaction that locks the tenant row, so the
 * proof has to include genuinely concurrent reservations from separate connections). Skipped unless SPENDCAP_TEST_DATABASE_URL is set (name must contain
 * test/scratch/tmp):  SPENDCAP_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/spendcap_test npx jest src/ai-core/credits/ai-credits.spend-cap.db.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { AiCreditsService, AiSpendCapReachedError, InsufficientAiCreditsError } from './ai-credits.service';

const url = process.env['SPENDCAP_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('SPENDCAP_TEST_DATABASE_URL must name a throwaway database.');
const describeDb = url ? describe : describe.skip;

const T = '00000000-0000-4000-8000-000000000001';
const quote = { reservedCredits: 10, maxCreditsPerAttempt: 10, creditsPerUsd: 100, inputPerMTokUsd: 1, outputPerMTokUsd: 1 };

describeDb('daily AI spend cap (real database)', () => {
  const mk = () => new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const pA = mk(); const pB = mk();
  const pricing = { getReservationQuote: async () => quote };
  const A = new AiCreditsService(pA as never, pricing as never);
  const B = new AiCreditsService(pB as never, pricing as never);
  let n = 0;

  async function reset(opts: { cap?: number | null; timezone?: string; credits?: number } = {}) {
    await pA.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    await pA.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, ai_credits, updated_at) VALUES ($1,'T','v',$2,now())`, T, opts.credits ?? 100000);
    await pA.$executeRawUnsafe(`INSERT INTO tenant_settings (id, tenant_id, timezone, ai_daily_credit_cap, updated_at) VALUES ('00000000-0000-4000-8000-0000000000aa',$1,$2,$3,now())`, T, opts.timezone ?? 'UTC', opts.cap ?? null);
  }
  /** a settled usage (negative) or refund (positive) ledger row at an exact naive-UTC time expression */
  async function ledger(type: 'AI_USAGE' | 'REFUND', credits: number, atSql = 'now()') {
    await pA.$executeRawUnsafe(`INSERT INTO ai_credit_transactions (id, tenant_id, type, credits, balance_after, description, created_at) VALUES ($1,$2,$3::"AiCreditTransactionType",$4,0,'t',${atSql} )`, `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, T, type, credits);
  }
  const reserved = () => pA.aiCreditReservation.count({ where: { tenantId: T } });
  afterAll(async () => { await pA.$disconnect(); await pB.$disconnect(); });

  it('no cap configured: reservations are unaffected by how much was spent today', async () => {
    await reset({ cap: null }); await ledger('AI_USAGE', -999999);
    await expect(A.reserveFixedCredits(T, 10)).resolves.toBeDefined();
  });

  it('reserves exactly up to the cap and refuses the first request over it, creating no reservation; the refusal is an InsufficientAiCreditsError subtype', async () => {
    await reset({ cap: 100 }); await ledger('AI_USAGE', -90);
    await expect(A.reserveFixedCredits(T, 10)).resolves.toBeDefined();       // 90 + 10 = 100: allowed
    const before = await reserved();
    const err = await A.reserveFixedCredits(T, 1).catch((e) => e);
    expect(err).toBeInstanceOf(AiSpendCapReachedError);
    expect(err).toBeInstanceOf(InsufficientAiCreditsError);                   // existing call sites treat it as "no AI reply"
    expect(err.message).toContain('Daily AI spend cap reached');
    expect(await reserved()).toBe(before);
  });

  it('open reservations count against the cap, and releasing one gives the headroom back immediately', async () => {
    await reset({ cap: 25 });
    const first = await A.reserveFixedCredits(T, 10);
    await A.reserveFixedCredits(T, 10);
    await expect(A.reserveFixedCredits(T, 10)).rejects.toBeInstanceOf(AiSpendCapReachedError);   // 20 held + 10 > 25
    await A.releaseReservation(first.id);
    await expect(A.reserveFixedCredits(T, 10)).resolves.toBeDefined();
  });

  it('CONCURRENCY: 20 simultaneous reservations from two independent connections never exceed the cap (exactly 5 of 10 credits fit in 50)', async () => {
    await reset({ cap: 50 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? A : B).reserveFixedCredits(T, 10)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof AiSpendCapReachedError).length;
    expect(ok).toBe(5);
    expect(refused).toBe(15);
    expect(await reserved()).toBe(5);
  });

  it('the provider-call reservation path is capped too (not only the fixed one)', async () => {
    await reset({ cap: 15 });
    await expect(A.reserveForProviderCall(T, 'deepseek', 'deepseek-v4-flash', 100, 1)).resolves.toBeDefined();   // 10
    await expect(A.reserveForProviderCall(T, 'deepseek', 'deepseek-v4-flash', 100, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
  });

  it('a cap of 0 blocks all AI; lowering the cap below today\'s spend blocks; removing the cap unblocks', async () => {
    await reset({ cap: 0 });
    await expect(A.reserveFixedCredits(T, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
    await reset({ cap: 1000 }); await ledger('AI_USAGE', -500);
    await expect(A.reserveFixedCredits(T, 10)).resolves.toBeDefined();
    await pA.$executeRawUnsafe(`UPDATE tenant_settings SET ai_daily_credit_cap = 400 WHERE tenant_id = $1`, T);
    await expect(A.reserveFixedCredits(T, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
    await pA.$executeRawUnsafe(`UPDATE tenant_settings SET ai_daily_credit_cap = NULL WHERE tenant_id = $1`, T);
    await expect(A.reserveFixedCredits(T, 1)).resolves.toBeDefined();
  });

  it('refunds reduce today\'s spend', async () => {
    await reset({ cap: 100 }); await ledger('AI_USAGE', -100); await ledger('REFUND', 30);
    await expect(A.reserveFixedCredits(T, 30)).resolves.toBeDefined();
    await expect(A.reserveFixedCredits(T, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
  });

  it('"today" is the workspace\'s own day: usage just before local midnight is excluded, just after is included, in a far-east and a far-west timezone', async () => {
    for (const tz of ['Pacific/Auckland', 'Pacific/Honolulu', 'UTC']) {
      await reset({ cap: 1000, timezone: tz });
      const midnightUtc = `((date_trunc('day', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}') AT TIME ZONE 'UTC')`;
      await ledger('AI_USAGE', -111, `${midnightUtc} - interval '1 minute'`);     // yesterday locally
      await ledger('AI_USAGE', -7, `${midnightUtc} + interval '1 second'`);       // today locally (the very first second)
      const summary = await A.getUsageSummary(T);
      expect(summary.spentToday).toBe(7);
      expect(summary.dailyCreditCap).toBe(1000);
    }
  });

  it('an invalid timezone name falls back to UTC instead of failing the reservation', async () => {
    await reset({ cap: 100, timezone: 'Not/AZone' }); await ledger('AI_USAGE', -95);
    await expect(A.reserveFixedCredits(T, 5)).resolves.toBeDefined();
    await expect(A.reserveFixedCredits(T, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
  });

  it('a workspace with no settings row has no cap', async () => {
    await pA.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    await pA.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, ai_credits, updated_at) VALUES ($1,'T','v',1000,now())`, T);
    await expect(A.reserveFixedCredits(T, 10)).resolves.toBeDefined();
  });

  it('the cap of one workspace never limits another', async () => {
    await reset({ cap: 0 });
    const T2 = '00000000-0000-4000-8000-000000000002';
    await pA.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, ai_credits, updated_at) VALUES ($1,'T2','v2',1000,now())`, T2);
    await expect(A.reserveFixedCredits(T2, 10)).resolves.toBeDefined();
    await expect(A.reserveFixedCredits(T, 1)).rejects.toBeInstanceOf(AiSpendCapReachedError);
  });

  it('the CHECK constraint refuses a negative cap at the database level', async () => {
    await reset({ cap: null });
    await expect(pA.$executeRawUnsafe(`UPDATE tenant_settings SET ai_daily_credit_cap = -1 WHERE tenant_id = $1`, T)).rejects.toThrow();
  });
});
