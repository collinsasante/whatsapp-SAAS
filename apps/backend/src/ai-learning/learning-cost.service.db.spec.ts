import { currentDisclosureVersion } from './learning-disclosure';
import { randomUUID } from 'crypto';
import { AiLearningCostService } from './learning-cost.service';
import { LearningCostConfig } from './learning-cost.config';
import { LEARNING_LEASE_MS, LEARNING_MAX_RUNS_PER_EXECUTION } from './learning-queue.constants';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);

const EST = 2_000; // estimated input tokens -> reservation = ceil(2000*0.3 + 500*1.2) = 1200 micros
const RESERVATION = 1_200n;
const BIG: LearningCostConfig = { workspaceMonthlyBudgetMicros: 1_000_000_000n, globalMonthlyBudgetMicros: 1_000_000_000n, maxReservationMicros: 50_000n };
const service = (config: Partial<LearningCostConfig> = {}) => new AiLearningCostService(prisma as never, { ...BIG, ...config });

async function optedIn(over: { learningPaused?: boolean; monthlyBudgetMicros?: bigint } = {}) {
  const tenantId = await fx.tenant();
  await prisma.aiLearningSettings.create({ data: { tenantId, learningEnabled: true, disclosureVersion: currentDisclosureVersion(), ...over } });
  return tenantId;
}
const reserve = (svc: AiLearningCostService, tenantId: string, aiExecutionId = randomUUID()) => svc.reserve({ tenantId, aiExecutionId, estimatedInputTokens: EST });
const lapse = (usageId: string) => prisma.$executeRaw`UPDATE ai_learning_usage SET lease_expires_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${usageId}`;
const rows = (aiExecutionId: string) => prisma.aiLearningUsage.findMany({ where: { aiExecutionId }, orderBy: { runNo: 'asc' } });

dbSuite('AiLearningCostService against a real PostgreSQL', () => {
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); }, 120_000); // many fixture tenants cascade-delete here: allow for a slow disposable database

  describe('eligibility', () => {
    it('does not reserve for a workspace that never opted in (no settings row)', async () => {
      const tenantId = await fx.tenant();
      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ kind: 'skipped', reason: 'not_enabled' });
    });

    it('does not reserve while learning is paused, even though it is enabled', async () => {
      const tenantId = await optedIn({ learningPaused: true });
      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ kind: 'skipped', reason: 'paused', retryLater: false });
    });

    it.each([['no acknowledgement recorded', null], ['an outdated acknowledgement', 'd1-000000000000']])('does not reserve for an opted-in workspace with %s, and makes no provider call possible', async (_label, version) => {
      const tenantId = await optedIn();
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { disclosureVersion: version } });
      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ kind: 'skipped', reason: 'disclosure_outdated', retryLater: false });
      expect(await prisma.aiLearningUsage.count({ where: { tenantId } })).toBe(0);
    });

    it('resumes as soon as the CURRENT acknowledgement is recorded', async () => {
      const tenantId = await optedIn();
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { disclosureVersion: 'd1-000000000000' } });
      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ reason: 'disclosure_outdated' });
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { disclosureVersion: currentDisclosureVersion() } });
      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ kind: 'reserved' });
    });

    it('writes nothing to the ledger for an ineligible workspace', async () => {
      const tenantId = await fx.tenant();
      await reserve(service(), tenantId);
      expect(await prisma.aiLearningUsage.count({ where: { tenantId } })).toBe(0);
    });
  });

  describe('reserve and settle', () => {
    it('reserves the estimate with a 60 s lease measured on the database clock', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const result = await reserve(service(), tenantId, execution);

      expect(result).toMatchObject({ kind: 'reserved', runNo: 1, reservedMicros: RESERVATION });
      const [row] = await rows(execution);
      expect(row).toMatchObject({ state: 'RESERVED', reservedMicros: RESERVATION, estimatedInputTokens: EST });
      expect(row!.priceTableVersion).toMatch(/peak-cache-miss/);
      expect(row!.leaseExpiresAt.getTime() - row!.createdAt.getTime()).toBeGreaterThanOrEqual(LEARNING_LEASE_MS - 1);
      expect(row!.leaseExpiresAt.getTime() - row!.createdAt.getTime()).toBeLessThan(LEARNING_LEASE_MS + 2_000);
    });

    it('settles with the provider-reported usage and refuses to pay for the same execution again', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      const r = await reserve(svc, tenantId, execution);
      if (r.kind !== 'reserved') throw new Error('expected a reservation');

      await expect(svc.settle(r.usageId, { inputTokens: 1_000, outputTokens: 200 })).resolves.toBe('completed');

      const [row] = await rows(execution);
      expect(row).toMatchObject({ state: 'COMPLETED', inputTokens: 1_000, outputTokens: 200, actualMicros: 540n }); // 1000*0.3 + 200*1.2
      await expect(reserve(svc, tenantId, execution)).resolves.toMatchObject({ kind: 'skipped', reason: 'already_settled', retryLater: false });
    });

    it('a second run while the first is still live is told to retry later and creates no row', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      await reserve(svc, tenantId, execution);

      await expect(reserve(svc, tenantId, execution)).resolves.toMatchObject({ kind: 'skipped', reason: 'in_flight', retryLater: true });
      expect(await rows(execution)).toHaveLength(1);
    });

    it('a failed call that was not billed counts as zero; an uncertain one keeps the whole reservation; a billed one counts its usage', async () => {
      const tenantId = await optedIn();
      const svc = service();
      const settleWith = async (charge: Parameters<AiLearningCostService['fail']>[1]) => {
        const execution = randomUUID();
        const r = await reserve(svc, tenantId, execution);
        if (r.kind !== 'reserved') throw new Error('expected a reservation');
        await expect(svc.fail(r.usageId, charge)).resolves.toBe('failed');
        return (await rows(execution))[0]!;
      };
      expect(await settleWith({ kind: 'not_billed' })).toMatchObject({ state: 'FAILED', actualMicros: 0n });
      expect(await settleWith({ kind: 'uncertain' })).toMatchObject({ state: 'FAILED', actualMicros: null });
      expect(await settleWith({ kind: 'billed', inputTokens: 100, outputTokens: 10 })).toMatchObject({ state: 'FAILED', actualMicros: 42n });
      // 1200 (uncertain, full reservation) + 0 + 42
      expect((await svc.summary(tenantId)).workspaceMicros).toBe(1_242n);
    });
  });

  describe('lease expiry, takeover and fencing', () => {
    it('a lapsed lease is expired by the next run, which then reserves with run number 2', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      const first = await reserve(svc, tenantId, execution);
      if (first.kind !== 'reserved') throw new Error('expected a reservation');
      await lapse(first.usageId);

      const second = await reserve(svc, tenantId, execution);

      expect(second).toMatchObject({ kind: 'reserved', runNo: 2 });
      expect((await rows(execution)).map((r) => [r.runNo, r.state])).toEqual([[1, 'EXPIRED'], [2, 'RESERVED']]);
    });

    it('a late result from the expired run is FENCED: recorded on its own row, never applied, and cannot touch the newer run', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      const first = await reserve(svc, tenantId, execution);
      if (first.kind !== 'reserved') throw new Error('expected a reservation');
      await lapse(first.usageId);
      const second = await reserve(svc, tenantId, execution);
      if (second.kind !== 'reserved') throw new Error('expected a reservation');

      await expect(svc.settle(first.usageId, { inputTokens: 500, outputTokens: 100 })).resolves.toBe('fenced');

      const [one, two] = await rows(execution);
      expect(one).toMatchObject({ state: 'FENCED', actualMicros: 270n }); // reconciled with the real usage
      expect(two).toMatchObject({ state: 'RESERVED', actualMicros: null });
      await expect(svc.settle(second.usageId, { inputTokens: 400, outputTokens: 50 })).resolves.toBe('completed');
    });

    it('a late result with NO takeover still settles normally (lease expiry alone fences nothing)', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      const r = await reserve(svc, tenantId, execution);
      if (r.kind !== 'reserved') throw new Error('expected a reservation');
      await lapse(r.usageId);

      await expect(svc.settle(r.usageId, { inputTokens: 10, outputTokens: 5 })).resolves.toBe('completed');
    });

    it('an EXPIRED reservation keeps its maximum estimate against the caps until it is reconciled', async () => {
      const tenantId = await optedIn({ monthlyBudgetMicros: RESERVATION + 500n });
      const svc = service();
      const first = await reserve(svc, tenantId);
      if (first.kind !== 'reserved') throw new Error('expected a reservation');
      await lapse(first.usageId);
      const execution2 = randomUUID();

      // first is lapsed but never settled; a different execution must still see its 1200 micros counted
      await expect(reserve(svc, tenantId, execution2)).resolves.toMatchObject({ kind: 'skipped', reason: 'workspace_cap' });
      await prisma.$executeRaw`UPDATE ai_learning_usage SET state = 'EXPIRED'::"AiLearningUsageState" WHERE id = ${first.usageId}`;
      await expect(reserve(svc, tenantId, randomUUID())).resolves.toMatchObject({ kind: 'skipped', reason: 'workspace_cap' });

      await expect(svc.reconcileExpired(first.usageId, 0n)).resolves.toBe(true);
      await expect(reserve(svc, tenantId, randomUUID())).resolves.toMatchObject({ kind: 'reserved' });
    });

    it('reconcileExpired only touches EXPIRED rows and rejects a negative amount', async () => {
      const tenantId = await optedIn();
      const svc = service();
      const r = await reserve(svc, tenantId);
      if (r.kind !== 'reserved') throw new Error('expected a reservation');
      await expect(svc.reconcileExpired(r.usageId, 0n)).resolves.toBe(false); // still RESERVED
      await expect(svc.reconcileExpired(r.usageId, -1n)).rejects.toThrow(RangeError);
    });

    it('RACE: a late finisher against a takeover never leaves a COMPLETED run beside a live reservation', async () => {
      const tenantId = await optedIn();
      const svc = service();
      const outcomes = { finisherWon: 0, takeoverWon: 0 };
      for (let i = 0; i < 25; i++) {
        const execution = randomUUID();
        const first = await reserve(svc, tenantId, execution);
        if (first.kind !== 'reserved') throw new Error('expected a reservation');
        await lapse(first.usageId);

        const [settled, takeover] = await Promise.all([
          svc.settle(first.usageId, { inputTokens: 100, outputTokens: 10 }),
          reserve(svc, tenantId, execution),
        ]);

        const states = (await rows(execution)).map((r) => r.state);
        expect(states.filter((s) => s === 'RESERVED').length).toBeLessThanOrEqual(1);
        if (settled === 'completed') {
          outcomes.finisherWon++;
          expect(states).toEqual(['COMPLETED']); // the takeover must have seen the completion and refused
          expect(takeover).toMatchObject({ kind: 'skipped', reason: 'already_settled' });
        } else {
          outcomes.takeoverWon++;
          expect(states).toEqual(['FENCED', 'RESERVED']);
          expect(takeover).toMatchObject({ kind: 'reserved', runNo: 2 });
        }
      }
      expect(outcomes.finisherWon + outcomes.takeoverWon).toBe(25);
    });
  });

  describe('per-execution run ceiling (3 attempts + 1 tolerated stall = 4)', () => {
    it('allows exactly four paid runs and then refuses, whatever the lease state', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      for (let run = 1; run <= LEARNING_MAX_RUNS_PER_EXECUTION; run++) {
        const r = await reserve(svc, tenantId, execution);
        expect(r).toMatchObject({ kind: 'reserved', runNo: run });
        if (r.kind === 'reserved') await svc.fail(r.usageId, { kind: 'uncertain' });
      }
      await expect(reserve(svc, tenantId, execution)).resolves.toMatchObject({ kind: 'skipped', reason: 'run_ceiling', retryLater: false });
      expect(await rows(execution)).toHaveLength(4);
    });

    it('stalled-and-recovered runs count too (expired rows are paid runs)', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();
      for (let run = 1; run <= LEARNING_MAX_RUNS_PER_EXECUTION; run++) {
        const r = await reserve(svc, tenantId, execution);
        if (r.kind !== 'reserved') throw new Error(`run ${run} should reserve`);
        await lapse(r.usageId);
      }
      await expect(reserve(svc, tenantId, execution)).resolves.toMatchObject({ kind: 'skipped', reason: 'run_ceiling' });
    });
  });

  describe('caps under concurrency', () => {
    it('the per-run cap rejects an oversized estimate and records why', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const result = await service({ maxReservationMicros: 1_000n }).reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
      expect(result).toMatchObject({ kind: 'skipped', reason: 'run_cap', retryLater: false });
      expect(await rows(execution)).toMatchObject([{ state: 'SKIPPED', skipReason: 'run_cap', reservedMicros: 0n }]);
    });

    it('PROOF: 20 concurrent reservations by one workspace never exceed its monthly cap', async () => {
      const cap = RESERVATION * 3n; // room for exactly three
      const tenantId = await optedIn({ monthlyBudgetMicros: cap });
      const svc = service();

      const results = await Promise.all(Array.from({ length: 20 }, () => reserve(svc, tenantId)));

      expect(results.filter((r) => r.kind === 'reserved')).toHaveLength(3);
      expect(results.filter((r) => r.kind === 'skipped' && r.reason === 'workspace_cap')).toHaveLength(17);
      expect((await svc.summary(tenantId)).workspaceMicros).toBeLessThanOrEqual(cap);
    });

    it('PROOF: 16 concurrent runs of the SAME execution produce exactly one reservation', async () => {
      const tenantId = await optedIn();
      const execution = randomUUID();
      const svc = service();

      const results = await Promise.all(Array.from({ length: 16 }, () => reserve(svc, tenantId, execution)));

      expect(results.filter((r) => r.kind === 'reserved')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'skipped' && r.reason === 'in_flight')).toHaveLength(15);
      expect(await rows(execution)).toHaveLength(1);
    });

    it('two workspaces do not consume each other\'s workspace cap', async () => {
      const a = await optedIn({ monthlyBudgetMicros: RESERVATION });
      const b = await optedIn({ monthlyBudgetMicros: RESERVATION });
      const svc = service();
      await expect(reserve(svc, a)).resolves.toMatchObject({ kind: 'reserved' });
      await expect(reserve(svc, b)).resolves.toMatchObject({ kind: 'reserved' });
      await expect(reserve(svc, a)).resolves.toMatchObject({ kind: 'skipped', reason: 'workspace_cap' });
    });

    it('rows from a previous month are not counted against this month', async () => {
      const tenantId = await optedIn({ monthlyBudgetMicros: RESERVATION });
      const old = await reserve(service(), tenantId);
      if (old.kind !== 'reserved') throw new Error('expected a reservation');
      await prisma.$executeRaw`UPDATE ai_learning_usage SET created_at = (date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') - interval '1 day') WHERE id = ${old.usageId}`;

      await expect(reserve(service(), tenantId)).resolves.toMatchObject({ kind: 'reserved' });
    });
  });

  describe('tripwire and credit isolation', () => {
    it('provider-reported input above the estimate pauses the workspace and is logged without content', async () => {
      const tenantId = await optedIn();
      const svc = service();
      const r = await reserve(svc, tenantId);
      if (r.kind !== 'reserved') throw new Error('expected a reservation');
      const errors = jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined);

      await expect(svc.settle(r.usageId, { inputTokens: EST + 1, outputTokens: 10 })).resolves.toBe('completed');

      expect((await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } })).learningPaused).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]![0])).toContain('ai_learning.cost_tripwire');
      await expect(reserve(svc, tenantId)).resolves.toMatchObject({ kind: 'skipped', reason: 'paused' });
    });

    it('reserving and settling learning cost never changes a workspace\'s AI credits or creates a credit transaction', async () => {
      const tenantId = await optedIn();
      await prisma.tenant.update({ where: { id: tenantId }, data: { aiCredits: 1_000 } });
      const svc = service();
      const r = await reserve(svc, tenantId);
      if (r.kind !== 'reserved') throw new Error('expected a reservation');
      await svc.settle(r.usageId, { inputTokens: 1_500, outputTokens: 300 });
      const second = await reserve(svc, tenantId);
      if (second.kind === 'reserved') await svc.fail(second.usageId, { kind: 'uncertain' });

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { aiCredits: true } });
      expect(tenant.aiCredits).toBe(1_000);
      expect(await prisma.aiCreditTransaction.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.aiCreditReservation.count({ where: { tenantId } })).toBe(0);
    });
  });
});
