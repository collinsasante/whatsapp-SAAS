/**
 * REAL BullMQ (Redis) + REAL PostgreSQL. Proves the claims behind the "at most 4 paid runs per execution" ceiling by running a real
 * Queue and real Workers with the production attempts/maxStalledCount/concurrency (only the timers are scaled down so a stall takes
 * milliseconds, not minutes), with the real cost ledger behind every run. Skipped unless AI_LEARNING_TEST_DATABASE_URL and
 * AI_LEARNING_TEST_REDIS_URL are set (see testing/db-test-env.ts).
 */
import { currentDisclosureVersion } from './learning-disclosure';
import { randomUUID } from 'crypto';
import { DelayedError, Job, Queue, Worker, WorkerOptions } from 'bullmq';
import { Test } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { AiLearningCostService } from './learning-cost.service';
import { AiLearningTriggerService, evalJobId } from './ai-learning-trigger.service';
import { AiInteractionEvalProcessor } from './ai-interaction-eval.processor';
import {
  LEARNING_JOB_ATTEMPTS, LEARNING_JOB_OPTIONS, LEARNING_MAX_RUNS_PER_EXECUTION, LEARNING_MAX_STALLED_COUNT, LEARNING_WORKER_OPTIONS,
} from './learning-queue.constants';
import { learningRedisUrl, makeFixtures, newTestClient, queueSuite } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const redis = learningRedisUrl ? new URL(learningRedisUrl) : undefined;
const connection = { host: redis?.hostname ?? '127.0.0.1', port: Number(redis?.port ?? 6379), maxRetriesPerRequest: null as null };
const EST = 2_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000, label = 'condition'): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error(`timed out waiting for ${label}`);
}

jest.setTimeout(60_000);

queueSuite('AI Learning queue behaviour against real BullMQ and PostgreSQL', () => {
  const cost = prisma ? new AiLearningCostService(prisma as never, { workspaceMonthlyBudgetMicros: 10n ** 12n, globalMonthlyBudgetMicros: 10n ** 12n, maxReservationMicros: 10n ** 9n }) : (undefined as unknown as AiLearningCostService);
  const closers: Array<() => Promise<unknown>> = [];
  const prefix = `ailtest-${randomUUID().slice(0, 8)}`;
  afterEach(async () => { while (closers.length) await closers.pop()!().catch(() => undefined); });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); }, 120_000); // many fixture tenants cascade-delete here: allow for a slow disposable database

  /** Production attempts, backoff shape, concurrency and maxStalledCount; only lock/stall timers (and the backoff delay) are scaled. */
  const scaledWorker = (over: Partial<WorkerOptions> = {}): WorkerOptions => ({ connection, prefix, ...LEARNING_WORKER_OPTIONS, lockDuration: 600, stalledInterval: 250, ...over });
  const jobOpts = { ...LEARNING_JOB_OPTIONS, backoff: { type: 'exponential' as const, delay: 30 }, removeOnComplete: false, removeOnFail: false };
  async function newQueue() {
    const queue = new Queue<{ tenantId: string; aiExecutionId: string }>(`q-${randomUUID().slice(0, 8)}`, { connection, prefix });
    closers.push(() => queue.obliterate({ force: true }).then(() => queue.close()));
    return queue;
  }
  async function optedIn() {
    const tenantId = await fx.tenant();
    await prisma.aiLearningSettings.create({ data: { tenantId, learningEnabled: true, disclosureVersion: currentDisclosureVersion() } });
    return tenantId;
  }
  const lapse = (execution: string) => prisma.$executeRaw`UPDATE ai_learning_usage SET lease_expires_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE ai_execution_id = ${execution} AND state = 'RESERVED'::"AiLearningUsageState"`;
  const ledger = (execution: string) => prisma.aiLearningUsage.findMany({ where: { aiExecutionId: execution }, orderBy: { runNo: 'asc' } });

  describe('the live configuration', () => {
    it('the real processor registers a worker with exactly the explicit options, and enqueued jobs carry the explicit attempts/backoff', async () => {
      const queued: string[] = [];
      const moduleRef = await Test.createTestingModule({
        imports: [BullModule.forRoot({ connection, prefix }), BullModule.registerQueue({ name: QueueName.AI_INTERACTION_EVAL })],
        providers: [
          AiInteractionEvalProcessor, AiLearningTriggerService,
          // The processor stops at the kill switch, so nothing downstream is touched and no provider is ever called.
          { provide: 'PrismaService', useValue: {} },
        ],
      })
        .useMocker((token) => {
          if (token === 'FeatureFlagsService' || (typeof token === 'function' && token.name === 'FeatureFlagsService')) return { isEnabledCached: jest.fn().mockImplementation(async () => { queued.push('flag'); return true; }) };
          return {};
        })
        .compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      closers.push(() => app.close());

      const processor = moduleRef.get(AiInteractionEvalProcessor);
      expect(processor.worker.opts).toMatchObject({ concurrency: 1, lockDuration: 30_000, stalledInterval: 30_000, maxStalledCount: 1 });

      const queue = moduleRef.get<Queue>(`BullQueue_${QueueName.AI_INTERACTION_EVAL}`);
      const trigger = moduleRef.get(AiLearningTriggerService);
      const execution = randomUUID();
      await trigger.maybeEnqueue({ tenantId: 'tenant-x', aiExecutionId: execution, taskType: 'RESPONDER', conversationId: 'c-1', status: 'SUCCESS' });
      const job = await queue.getJob(evalJobId(execution));
      expect(job?.opts).toMatchObject({ attempts: LEARNING_JOB_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 500, removeOnFail: 500 });
      expect(job?.id).toBe(evalJobId(execution));
      await queue.obliterate({ force: true }).catch(() => undefined);
    });

    it('the production constants give a ceiling of 4 and the database enforces that same number', () => {
      expect(LEARNING_MAX_RUNS_PER_EXECUTION).toBe(LEARNING_JOB_ATTEMPTS + LEARNING_MAX_STALLED_COUNT);
      expect(LEARNING_MAX_RUNS_PER_EXECUTION).toBe(4);
    });
  });

  describe('retries', () => {
    it('a job that always fails is run exactly 3 times, each a separately accounted run, and never a 4th', async () => {
      const queue = await newQueue();
      const tenantId = await optedIn();
      const execution = randomUUID();
      let invocations = 0;
      const worker = new Worker(queue.name, async () => {
        invocations++;
        const r = await cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
        if (r.kind === 'reserved') await cost.fail(r.usageId, { kind: 'uncertain' });
        throw new Error('provider unavailable');
      }, scaledWorker());
      closers.push(() => worker.close(true));

      const job = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution) });
      await until(async () => (await job.getState()) === 'failed', 20_000, 'job to fail');

      expect(invocations).toBe(3);
      expect((await ledger(execution)).map((r) => [r.runNo, r.state])).toEqual([[1, 'FAILED'], [2, 'FAILED'], [3, 'FAILED']]);
      expect((await Job.fromId(queue, job.id!))?.attemptsMade).toBe(LEARNING_JOB_ATTEMPTS);
    });

    it('an enqueue with the same job id while the job exists is ignored (no second job)', async () => {
      const queue = await newQueue();
      const execution = randomUUID();
      const first = await queue.add('evaluate', { tenantId: 't', aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution), delay: 60_000 });
      const second = await queue.add('evaluate', { tenantId: 't', aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution), delay: 60_000 });
      expect(second.id).toBe(first.id);
      expect(await queue.getDelayedCount()).toBe(1);
    });
  });

  describe('stalled jobs', () => {
    /** A processor that reserves and then hangs forever with lock renewal off: the way a crashed or frozen process looks to BullMQ. */
    const stallingWorker = (queueName: string, tenantId: string, execution: string, counter: { n: number }) => {
      const w = new Worker(queueName, async () => {
        counter.n++;
        await cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
        await new Promise<never>(() => undefined);
      }, scaledWorker({ skipLockRenewal: true }));
      closers.push(() => w.close(true));
      return w;
    };

    it('a stall plus three failures is exactly 4 processor runs; the ledger shows 4 paid runs and refuses a 5th', async () => {
      const queue = await newQueue();
      const tenantId = await optedIn();
      const execution = randomUUID();
      const counter = { n: 0 };
      stallingWorker(queue.name, tenantId, execution, counter); // run 1 stalls
      const healthy = new Worker(queue.name, async () => {
        counter.n++;
        // the stalled run's lease has long lapsed in real time (60 s) by the time BullMQ recovers the job (>= 30 s); emulate that
        await lapse(execution);
        const r = await cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
        if (r.kind === 'reserved') await cost.fail(r.usageId, { kind: 'uncertain' });
        throw new Error('provider unavailable');
      }, scaledWorker({ stalledInterval: 250 }));
      closers.push(() => healthy.close(true));
      // keep the healthy worker idle until the first (stalling) worker has taken the job
      await healthy.pause();

      const job = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution) });
      await until(async () => counter.n >= 1 && (await ledger(execution)).length >= 1, 20_000, 'run 1 to reserve');
      await healthy.resume();
      await until(async () => (await job.getState()) === 'failed', 30_000, 'job to fail');

      expect(counter.n).toBe(LEARNING_MAX_RUNS_PER_EXECUTION);
      const runs = await ledger(execution);
      expect(runs).toHaveLength(4);
      expect(runs.map((r) => r.state)).toEqual(['EXPIRED', 'FAILED', 'FAILED', 'FAILED']);
      await expect(cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST })).resolves.toMatchObject({ kind: 'skipped', reason: 'run_ceiling' });
    });

    it('a SECOND stall fails the job without running the processor again', async () => {
      const queue = await newQueue();
      const tenantId = await optedIn();
      const execution = randomUUID();
      const counter = { n: 0 };
      stallingWorker(queue.name, tenantId, execution, counter);
      const second = stallingWorker(queue.name, tenantId, execution, counter);
      await second.pause();

      const job = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution) });
      // The reservation must be committed before its lease is lapsed (counter.n is bumped before reserve() returns).
      await until(async () => counter.n >= 1 && (await ledger(execution)).length >= 1, 20_000, 'run 1 to reserve');
      await lapse(execution);
      await second.resume();
      // counter.n is bumped when the processor starts, before its reservation commits: wait for the committed run-2 row itself.
      await until(async () => counter.n >= 2 && (await ledger(execution)).length >= 2, 20_000, 'run 2 (the recovered job) to reserve');
      // Both workers are now hung. BullMQ records the second stall and applies the failure when a worker next picks the job up, so a
      // healthy worker (as in production) is added; if the processor were invoked again it would count here.
      const healthy = new Worker(queue.name, async () => { counter.n++; return 'must-not-run'; }, scaledWorker());
      closers.push(() => healthy.close(true));
      await until(async () => (await job.getState()) === 'failed', 30_000, 'job to fail after the second stall');

      expect(counter.n).toBe(1 + LEARNING_MAX_STALLED_COUNT); // 2 runs, never a third
      const failed = await Job.fromId(queue, job.id!);
      expect(failed?.failedReason).toMatch(/stalled more than allowable limit/);
      expect(await ledger(execution)).toHaveLength(2);
    });
  });

  describe('delayed jobs cannot bypass the database protections', () => {
    it('a delayed job reserves only when it actually makes a paid call, and a re-activation after a live reservation is refused', async () => {
      const queue = await newQueue();
      const tenantId = await optedIn();
      const execution = randomUUID();
      const seen: string[] = [];
      const attemptsMadeAtActivation: number[] = [];
      const worker = new Worker(queue.name, async (job: Job, token?: string) => {
        const r = await cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
        seen.push(r.kind === 'reserved' ? `reserved:${r.runNo}` : `skipped:${r.reason}`);
        attemptsMadeAtActivation.push(job.attemptsMade);
        if (r.kind === 'reserved') {
          // The paid call starts, then the job is moved to the delayed set (as a rate-limit style pause would do) without settling.
          await job.moveToDelayed(Date.now() + 150, token);
          throw new DelayedError();
        }
        return 'done';
      }, scaledWorker());
      closers.push(() => worker.close(true));

      const job = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: evalJobId(execution) });
      await until(async () => seen.length >= 2, 15_000, 'second activation');
      await until(async () => (await job.getState()) === 'completed', 15_000, 'job to complete');

      expect(seen.slice(0, 2)).toEqual(['reserved:1', 'skipped:in_flight']); // the re-activation did NOT get a second reservation
      expect(await ledger(execution)).toHaveLength(1);
      // Delaying consumed no attempt (the second activation still saw 0 attempts made), which is exactly why the ledger, not
      // attemptsMade, is the guard; the activation counter still advanced.
      expect(attemptsMadeAtActivation.slice(0, 2)).toEqual([0, 0]);
      expect((await Job.fromId(queue, job.id!))?.attemptsStarted).toBeGreaterThanOrEqual(2);
    });

    it('an evicted job that is enqueued again (new job record, same execution) cannot pay twice', async () => {
      const queue = await newQueue();
      const tenantId = await optedIn();
      const execution = randomUUID();
      const worker = new Worker(queue.name, async () => {
        const r = await cost.reserve({ tenantId, aiExecutionId: execution, estimatedInputTokens: EST });
        if (r.kind !== 'reserved') return r.reason;
        await cost.settle(r.usageId, { inputTokens: 100, outputTokens: 10 });
        return 'paid';
      }, scaledWorker());
      closers.push(() => worker.close(true));

      const first = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: `first-${execution}` });
      await until(async () => (await first.getState()) === 'completed', 15_000, 'first job');
      const again = await queue.add('evaluate', { tenantId, aiExecutionId: execution }, { ...jobOpts, jobId: `second-${execution}` });
      await until(async () => (await again.getState()) === 'completed', 15_000, 'second job');

      expect((await Job.fromId(queue, first.id!))?.returnvalue).toBe('paid');
      expect((await Job.fromId(queue, again.id!))?.returnvalue).toBe('already_settled');
      expect(await ledger(execution)).toHaveLength(1);
    });
  });
});
