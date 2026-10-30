import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AiInteractionEvalProcessor } from '../src/ai-learning/ai-interaction-eval.processor';
import { InternalTasksService } from '../src/internal-tasks/internal-tasks.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * AI-learning evaluation writes and review-task creation against a REAL PostgreSQL, with two separate Prisma clients (two
 * connection pools) so that the interleavings are genuine database concurrency, not simulated.
 *
 * SAFETY: these tests create and delete rows. They run ONLY when ALL of the following hold, otherwise the whole suite is skipped:
 *   - AI_LEARNING_PG_TESTS=1 (an explicit opt-in),
 *   - DATABASE_URL points at localhost / 127.0.0.1 / ::1,
 *   - and the database name contains "test".
 * They never TRUNCATE anything (unlike test/utils/test-db.ts resetTestDatabase) and delete only the tenants they created. The
 * connection string is never printed. The schema must already be migrated (`prisma migrate deploy`) against that database.
 *
 * No AI provider is involved: the evaluator is a stub, so no paid call can happen.
 */
function disposableDatabaseConfigured(): boolean {
  if (process.env.AI_LEARNING_PG_TESTS !== '1') return false;
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) && /test/i.test(databaseName);
  } catch {
    return false;
  }
}

const suite = disposableDatabaseConfigured() ? describe : describe.skip;

const good = {
  dimensions: { accuracy: 5 }, overallScore: 5, failureCategories: [], severity: null,
  reasoning: 'ok', confidence: 0.9, needsHumanReview: false, falseActionClaim: false,
  falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** True if the promise has not settled within `ms`. */
async function stillPending(p: Promise<unknown>, ms = 400): Promise<boolean> {
  return Promise.race([p.then(() => false, () => false), sleep(ms).then(() => true)]);
}

suite('AI learning against a real PostgreSQL (disposable database only)', () => {
  jest.setTimeout(60_000);

  let clientA: PrismaClient;
  let clientB: PrismaClient;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    clientA = new PrismaClient();
    clientB = new PrismaClient();
    await clientA.$connect();
    await clientB.$connect();
  });

  afterEach(async () => {
    // Only what this suite created. Tenant deletion cascades to its conversations, executions, evaluations and tasks.
    if (tenantIds.length) await clientA.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });

  afterAll(async () => {
    await clientA.$disconnect();
    await clientB.$disconnect();
  });

  async function seed(opts: { evaluation?: { status: 'EVALUATED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'PENDING'; severity?: 'CRITICAL' | 'HIGH' | 'LOW'; overallScore?: number } } = {}) {
    const tenant = await clientA.tenant.create({ data: { name: `ai-learning-it ${randomUUID().slice(0, 8)}`, webhookVerifyToken: randomUUID() } });
    tenantIds.push(tenant.id);
    const contact = await clientA.contact.create({ data: { tenantId: tenant.id, phone: '+233000000000', name: 'Integration Test' } });
    const conversation = await clientA.conversation.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN' } });
    const execution = await clientA.aiExecution.create({
      data: { tenantId: tenant.id, conversationId: conversation.id, taskType: 'RESPONDER', provider: 'test', modelKey: 'test', status: 'SUCCESS' },
    });
    const evaluation = opts.evaluation
      ? await clientA.aiInteractionEvaluation.create({
        data: {
          tenantId: tenant.id, conversationId: conversation.id, aiExecutionId: execution.id,
          status: opts.evaluation.status, severity: opts.evaluation.severity ?? null, overallScore: opts.evaluation.overallScore ?? null,
          needsHumanReview: opts.evaluation.status === 'NEEDS_REVIEW', evaluatorReasoning: 'seeded', failureCategories: [],
        },
      })
      : null;
    return { tenant, contact, conversation, execution, evaluation };
  }

  type Seeded = Awaited<ReturnType<typeof seed>>;

  function makeProcessor(
    prisma: PrismaClient,
    seeded: Seeded,
    hooks: { evaluate?: () => Promise<unknown>; beforeTaskCreate?: () => Promise<void> } = {},
  ) {
    // The REAL InternalTasksService (team matching and the insert); only notifications are stubbed out, they are not under test.
    const notifications = new Proxy({}, { get: () => async () => undefined });
    const realTasks = new InternalTasksService(prisma as unknown as PrismaService, notifications as never);
    const internalTasks = {
      create: async (tenantId: string, input: Parameters<InternalTasksService['create']>[1]) => {
        if (hooks.beforeTaskCreate) await hooks.beforeTaskCreate();
        return realTasks.create(tenantId, input);
      },
    };
    const resolver = {
      resolve: async () => ({
        conversationId: seeded.conversation.id, contactId: seeded.contact.id, customerMessage: 'm', aiResponse: 'a',
        priorContext: [], latestOrderStatus: null, handoffTaskExists: false, humanOwned: false, conversationStatus: 'OPEN',
      }),
    };
    const evaluator = { evaluate: hooks.evaluate ?? (async () => { throw new Error('the provider must not be called in this test'); }) };
    const featureFlags = { isEnabledCached: async () => true };
    return new AiInteractionEvalProcessor(prisma as unknown as PrismaService, resolver as never, evaluator as never, internalTasks as never, featureFlags as never);
  }

  const job = (seeded: Seeded, attemptsMade = 0) => ({ data: { aiExecutionId: seeded.execution.id, tenantId: seeded.tenant.id }, attemptsMade, opts: { attempts: 3 } }) as never;
  const tasksFor = (seeded: Seeded) => clientA.internalTask.findMany({ where: { tenantId: seeded.tenant.id, department: 'ai_review' } });

  describe('1. conditional writes preserve final evaluations (through the real unique index)', () => {
    it.each(['EVALUATED', 'APPROVED', 'REJECTED'] as const)('a run that finishes after a %s row appeared does not overwrite it', async (status) => {
      const seeded = await seed();
      const entered = deferred();
      const release = deferred();
      const processor = makeProcessor(clientA, seeded, { evaluate: async () => { entered.resolve(); await release.promise; return good; } });

      const run = processor.process(job(seeded));
      await entered.promise; // the pre-check has passed (no row) and the "provider call" is in flight
      await clientB.aiInteractionEvaluation.create({
        data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, aiExecutionId: seeded.execution.id, status, overallScore: 2, evaluatorReasoning: 'winner', failureCategories: [] },
      });
      release.resolve();
      await run;

      const rows = await clientA.aiInteractionEvaluation.findMany({ where: { aiExecutionId: seeded.execution.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status, overallScore: 2, evaluatorReasoning: 'winner' });
    });

    it('a FAILED row that appeared in the gap is updated with the paid result (the result is not lost)', async () => {
      const seeded = await seed();
      const entered = deferred();
      const release = deferred();
      const processor = makeProcessor(clientA, seeded, { evaluate: async () => { entered.resolve(); await release.promise; return good; } });
      const run = processor.process(job(seeded));
      await entered.promise;
      await clientB.aiInteractionEvaluation.create({
        data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, aiExecutionId: seeded.execution.id, status: 'FAILED', evaluationError: 'transient', failureCategories: [] },
      });
      release.resolve();
      await run;
      const row = await clientA.aiInteractionEvaluation.findUniqueOrThrow({ where: { aiExecutionId: seeded.execution.id } });
      expect(row).toMatchObject({ status: 'EVALUATED', overallScore: 5, evaluationError: null });
    });

    it('a conflicting row owned by another tenant is never read or changed', async () => {
      const seeded = await seed();
      const other = await clientA.tenant.create({ data: { name: `ai-learning-it-other ${randomUUID().slice(0, 8)}`, webhookVerifyToken: randomUUID() } });
      tenantIds.push(other.id);
      const otherContact = await clientA.contact.create({ data: { tenantId: other.id, phone: '+233000000001', name: 'Other' } });
      const otherConversation = await clientA.conversation.create({ data: { tenantId: other.id, contactId: otherContact.id, status: 'OPEN' } });
      // A foreign-tenant evaluation on this tenant's execution: an integrity anomaly the code must not touch.
      await clientA.aiInteractionEvaluation.create({
        data: { tenantId: other.id, conversationId: otherConversation.id, aiExecutionId: seeded.execution.id, status: 'FAILED', evaluationError: 'theirs', failureCategories: [] },
      });
      const processor = makeProcessor(clientA, seeded, { evaluate: async () => good });
      await expect(processor.process(job(seeded))).resolves.toBeUndefined();
      const row = await clientA.aiInteractionEvaluation.findUniqueOrThrow({ where: { aiExecutionId: seeded.execution.id } });
      expect(row).toMatchObject({ tenantId: other.id, status: 'FAILED', evaluationError: 'theirs' });
    });
  });

  describe('2. two writers racing to store a result', () => {
    it('exactly one evaluation row and one audit record result, whichever writer wins', async () => {
      const seeded = await seed();
      const enteredA = deferred(); const enteredB = deferred(); const release = deferred();
      const a = makeProcessor(clientA, seeded, { evaluate: async () => { enteredA.resolve(); await release.promise; return { ...good, overallScore: 1 }; } });
      const b = makeProcessor(clientB, seeded, { evaluate: async () => { enteredB.resolve(); await release.promise; return { ...good, overallScore: 4 }; } });
      const runA = a.process(job(seeded));
      const runB = b.process(job(seeded));
      await Promise.all([enteredA.promise, enteredB.promise]); // both passed the pre-check
      release.resolve();
      await Promise.all([runA, runB]);

      const rows = await clientA.aiInteractionEvaluation.findMany({ where: { aiExecutionId: seeded.execution.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('EVALUATED');
      expect([1, 4]).toContain(rows[0].overallScore);
      const audits = await clientA.aiLearningAuditLog.count({ where: { tenantId: seeded.tenant.id, action: 'evaluation.completed', targetId: rows[0].id } });
      expect(audits).toBe(1);
    });
  });

  describe('3. two concurrent task-creation attempts', () => {
    it('produce exactly one review task, over repeated rounds', async () => {
      for (let round = 0; round < 8; round++) {
        const seeded = await seed({ evaluation: { status: 'NEEDS_REVIEW', severity: 'CRITICAL' } });
        const a = makeProcessor(clientA, seeded);
        const b = makeProcessor(clientB, seeded);
        await Promise.all([a.process(job(seeded)), b.process(job(seeded))]);
        const tasks = await tasksFor(seeded);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toContain(seeded.evaluation!.id);
      }
    });

    it('stay at exactly one even when the first creator is slow (the second must wait on the row lock, not race past it)', async () => {
      const seeded = await seed({ evaluation: { status: 'NEEDS_REVIEW', severity: 'HIGH' } });
      const creating = deferred(); const proceed = deferred();
      const slow = makeProcessor(clientA, seeded, { beforeTaskCreate: async () => { creating.resolve(); await proceed.promise; } });
      const fast = makeProcessor(clientB, seeded);
      const runSlow = slow.process(job(seeded));
      await creating.promise;                       // the slow worker holds the lock and has not created the task yet
      const runFast = fast.process(job(seeded));
      expect(await stillPending(runFast)).toBe(true); // blocked on the lock
      proceed.resolve();
      await Promise.all([runSlow, runFast]);
      expect(await tasksFor(seeded)).toHaveLength(1);
    });
  });

  describe('4. approval racing with task creation', () => {
    it('an approval that is committed first prevents the task', async () => {
      const seeded = await seed({ evaluation: { status: 'NEEDS_REVIEW', severity: 'CRITICAL' } });
      const approved = deferred(); const commit = deferred();
      const approval = clientB.$transaction(async (tx) => {
        await tx.aiInteractionEvaluation.update({ where: { id: seeded.evaluation!.id }, data: { status: 'APPROVED' } });
        approved.resolve();
        await commit.promise; // decision made, not yet visible to other connections
      });
      await approved.promise;
      const run = makeProcessor(clientA, seeded).process(job(seeded)); // its snapshot still says NEEDS_REVIEW
      expect(await stillPending(run)).toBe(true);                       // blocked on the row lock the approval holds
      commit.resolve();
      await approval;
      await run;
      expect(await tasksFor(seeded)).toHaveLength(0);
      expect((await clientA.aiInteractionEvaluation.findUniqueOrThrow({ where: { id: seeded.evaluation!.id } })).status).toBe('APPROVED');
    });

    it('an approval that arrives while the task is being created waits for it, so the task exists exactly once and the decision stands', async () => {
      const seeded = await seed({ evaluation: { status: 'NEEDS_REVIEW', severity: 'CRITICAL' } });
      const creating = deferred(); const proceed = deferred();
      const run = makeProcessor(clientA, seeded, { beforeTaskCreate: async () => { creating.resolve(); await proceed.promise; } }).process(job(seeded));
      await creating.promise;
      const approval = clientB.aiInteractionEvaluation.update({ where: { id: seeded.evaluation!.id }, data: { status: 'APPROVED' } });
      expect(await stillPending(approval)).toBe(true); // the UPDATE conflicts with the task transaction's row lock
      proceed.resolve();
      await Promise.all([run, approval]);
      expect(await tasksFor(seeded)).toHaveLength(1);
      expect((await clientA.aiInteractionEvaluation.findUniqueOrThrow({ where: { id: seeded.evaluation!.id } })).status).toBe('APPROVED');
    });
  });
});
