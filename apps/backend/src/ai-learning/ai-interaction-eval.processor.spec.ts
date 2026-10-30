import { AiInteractionEvalProcessor } from './ai-interaction-eval.processor';
import { TransientJudgeError } from './ai-interaction-evaluator.service';
import { ResolvedInteractionContext } from './interaction-context.resolver';

function buildContext(): ResolvedInteractionContext {
  return {
    conversationId: 'conv-1', contactId: 'contact-1', customerMessage: 'hi', aiResponse: 'hello',
    priorContext: [], latestOrderStatus: null, handoffTaskExists: false, humanOwned: false, conversationStatus: 'OPEN',
  };
}

function buildJob(overrides: Partial<{ attemptsMade: number; attempts: number; data: unknown }> = {}) {
  return {
    data: 'data' in overrides ? overrides.data : { aiExecutionId: 'exec-1', tenantId: 'tenant-1' },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as never;
}

const good = {
  dimensions: { accuracy: 5 }, overallScore: 5, failureCategories: [], severity: null,
  reasoning: 'ok', confidence: 0.9, needsHumanReview: false, falseActionClaim: false,
  falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false,
};
const critical = {
  dimensions: { accuracy: 1 }, overallScore: 1, failureCategories: ['WRONG_PAYMENT_STATE'], severity: 'CRITICAL',
  reasoning: 'False payment claim', confidence: 0.9, needsHumanReview: true, falseActionClaim: false,
  falseSuccessClaim: true, unnecessaryHandoff: false, customerCorrectionDetected: false,
};

type Row = Record<string, unknown> & { id: string; tenantId: string; aiExecutionId: string; status: string };

/**
 * A small stateful stand-in for the evaluation table that honours exactly the semantics the processor relies on: `updateMany`
 * applies its `where` (tenant AND status filter) atomically, and `create` fails with P2002 when the unique aiExecutionId exists.
 * It deliberately has NO `upsert`: the processor must not use one (it cannot carry a status condition).
 */
function fakeEvaluations(seed: Array<Partial<Row> & { aiExecutionId: string; tenantId: string; status: string }> = []) {
  const rows = new Map<string, Row>();
  let n = 0;
  for (const s of seed) rows.set(s.aiExecutionId, { id: `eval-seed-${++n}`, conversationId: 'conv-1', contactId: 'contact-1', severity: null, failureCategories: [], evaluatorReasoning: null, ...s } as Row);
  const pick = (row: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);
  const api = {
    findFirst: jest.fn(async ({ where, select }: { where: { aiExecutionId: string; tenantId: string }; select?: Record<string, boolean> }) => {
      const r = rows.get(where.aiExecutionId);
      return r && r.tenantId === where.tenantId ? pick(r, select) : null;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { aiExecutionId: string; tenantId: string; status: { in: string[] } }; data: Record<string, unknown> }) => {
      const r = rows.get(where.aiExecutionId);
      if (!r || r.tenantId !== where.tenantId || !where.status.in.includes(r.status)) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    }),
    create: jest.fn(async ({ data, select }: { data: Record<string, unknown> & { aiExecutionId: string }; select?: Record<string, boolean> }) => {
      if (rows.has(data.aiExecutionId)) throw Object.assign(new Error('Unique constraint failed on ai_execution_id'), { code: 'P2002' });
      const row = { id: `eval-${++n}`, ...data } as Row;
      rows.set(data.aiExecutionId, row);
      return pick(row, select);
    }),
  };
  // `SELECT status::text FROM ai_interaction_evaluations WHERE id AND tenant_id FOR UPDATE`, as the processor issues it through $queryRaw.
  const lock = { override: undefined as string | null | undefined, calls: [] as Array<{ id: string; tenantId: string }>, sql: [] as string[] };
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, id: string, tenantId: string) => {
    lock.calls.push({ id, tenantId });
    lock.sql.push(strings.join('?').replace(/\s+/g, ' ').trim());
    if (lock.override !== undefined) return lock.override === null ? [] : [{ status: lock.override }];
    const row = [...rows.values()].find((r) => r.id === id && r.tenantId === tenantId);
    return row ? [{ status: row.status }] : [];
  });
  return { rows, api, lock, queryRaw };
}

function fakeTasks() {
  const tasks: Array<{ tenantId: string; title: string; description: string; priority: string; conversationId: string; contactId?: string }> = [];
  const internalTask = {
    findFirst: jest.fn(async ({ where }: { where: { tenantId: string; conversationId: string; title: { contains: string } } }) =>
      tasks.find((t) => t.tenantId === where.tenantId && t.conversationId === where.conversationId && t.title.includes(where.title.contains)) ? { id: 'task-x' } : null),
  };
  const internalTasks = {
    create: jest.fn(async (tenantId: string, d: { title: string; description: string; priority: string; conversationId: string; contactId?: string }) => { tasks.push({ tenantId, ...d }); return {}; }),
  };
  return { tasks, internalTask, internalTasks };
}

function build(opts: { db?: ReturnType<typeof fakeEvaluations>; tasks?: ReturnType<typeof fakeTasks> } = {}) {
  const db = opts.db ?? fakeEvaluations();
  const t = opts.tasks ?? fakeTasks();
  const events: string[] = [];
  const tx = { $queryRaw: db.queryRaw, internalTask: t.internalTask };
  const prisma = {
    aiInteractionEvaluation: db.api,
    aiLearningAuditLog: { create: jest.fn().mockResolvedValue({}) },
    internalTask: t.internalTask,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => { events.push(`begin:${JSON.stringify(options)}`); try { return await fn(tx); } finally { events.push('end'); } }),
  };
  t.internalTasks.create.mockImplementation(async (tenantId: string, d: never) => { events.push('task-create'); t.tasks.push({ tenantId, ...(d as object) } as never); return {}; });
  const resolver = { resolve: jest.fn().mockResolvedValue(buildContext()) };
  const evaluator = { evaluate: jest.fn().mockResolvedValue(good) };
  const featureFlags = { isEnabledCached: jest.fn().mockResolvedValue(true) };
  const processor = new AiInteractionEvalProcessor(prisma as never, resolver as never, evaluator as never, t.internalTasks as never, featureFlags as never);
  return { processor, db, prisma, resolver, evaluator, featureFlags, events, ...t };
}

/** A promise a test resolves by hand, to hold a run "inside" the provider call while another run proceeds. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

describe('AiInteractionEvalProcessor', () => {
  it('throws (for BullMQ to retry) when the interaction context is not yet resolvable', async () => {
    const { processor, resolver } = build();
    resolver.resolve.mockResolvedValue(null);
    await expect(processor.process(buildJob())).rejects.toThrow();
  });

  it('stores the evaluation for the job tenant and execution', async () => {
    const { processor, db, evaluator } = build();
    await processor.process(buildJob());
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(db.rows.get('exec-1')).toMatchObject({ tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: 'EVALUATED', overallScore: 5 });
  });

  describe('retry policy', () => {
    it('records a permanent failure (null result) as FAILED at once, without retrying', async () => {
      const { processor, db, evaluator } = build();
      evaluator.evaluate.mockResolvedValue(null);
      await expect(processor.process(buildJob({ attemptsMade: 0, attempts: 3 }))).resolves.toBeUndefined();
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      expect(db.rows.get('exec-1')).toMatchObject({ status: 'FAILED', tenantId: 'tenant-1', aiExecutionId: 'exec-1' });
    });

    it('rethrows a transient failure so the queue retries, and persists FAILED only on the last attempt', async () => {
      const { processor, db, evaluator } = build();
      evaluator.evaluate.mockRejectedValue(new TransientJudgeError('HTTP 503'));
      await expect(processor.process(buildJob({ attemptsMade: 0, attempts: 3 }))).rejects.toBeInstanceOf(TransientJudgeError);
      await expect(processor.process(buildJob({ attemptsMade: 1, attempts: 3 }))).rejects.toBeInstanceOf(TransientJudgeError);
      expect(db.rows.size).toBe(0);
      await expect(processor.process(buildJob({ attemptsMade: 2, attempts: 3 }))).resolves.toBeUndefined();
      expect(db.rows.get('exec-1')).toMatchObject({ status: 'FAILED', retryCount: 2 });
    });

    it('makes at most one provider call per attempt: three attempts is three calls, never more', async () => {
      const { processor, evaluator } = build();
      evaluator.evaluate.mockRejectedValue(new TransientJudgeError('network'));
      for (let attempt = 0; attempt < 3; attempt++) await processor.process(buildJob({ attemptsMade: attempt, attempts: 3 })).catch(() => undefined);
      expect(evaluator.evaluate).toHaveBeenCalledTimes(3);
    });

    it('rethrows an unexpected (non-transient) evaluator exception rather than swallowing it', async () => {
      const { processor, db, evaluator } = build();
      evaluator.evaluate.mockRejectedValue(new Error('bug'));
      await expect(processor.process(buildJob({ attemptsMade: 2, attempts: 3 }))).rejects.toThrow('bug');
      expect(db.rows.size).toBe(0);
    });
  });

  describe('duplicate delivery: no second paid call for an evaluation that already exists', () => {
    it.each(['EVALUATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'])('skips the provider (and the resolver) when the row is %s, leaving it untouched', async (status) => {
      const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status, overallScore: 3 }]);
      const { processor, resolver, evaluator } = build({ db });
      await expect(processor.process(buildJob())).resolves.toBeUndefined();
      expect(evaluator.evaluate).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(db.api.updateMany).not.toHaveBeenCalled();
      expect(db.api.create).not.toHaveBeenCalled();
      expect(db.rows.get('exec-1')).toMatchObject({ status, overallScore: 3 });
    });

    it.each(['FAILED', 'PENDING'])('still evaluates when the existing row is %s, and updates that row in place', async (status) => {
      const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status, evaluationError: 'earlier failure' }]);
      const { processor, evaluator } = build({ db });
      await processor.process(buildJob());
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      expect(db.rows.size).toBe(1);
      expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-seed-1', status: 'EVALUATED', overallScore: 5, evaluationError: null });
    });

    it('looks the existing evaluation up within the job tenant (tenant isolation)', async () => {
      const { processor, db, resolver } = build();
      resolver.resolve.mockResolvedValue(null);
      await processor.process(buildJob()).catch(() => undefined);
      expect(db.api.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { aiExecutionId: 'exec-1', tenantId: 'tenant-1' } }));
    });

    it('the same job delivered twice makes one provider call once the first result is stored', async () => {
      const { processor, evaluator } = build();
      await processor.process(buildJob());
      await processor.process(buildJob());
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });

    it('does not read or touch another tenant\'s evaluation for the same execution id', async () => {
      const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-OTHER', status: 'APPROVED', overallScore: 4 }]);
      const { processor } = build({ db });
      await expect(processor.process(buildJob())).resolves.toBeUndefined();
      expect(db.rows.get('exec-1')).toMatchObject({ tenantId: 'tenant-OTHER', status: 'APPROVED', overallScore: 4 });
    });
  });

  describe('R1: an evaluation run can never overwrite a final result', () => {
    it('never uses upsert, and every update is constrained to the writable statuses within the tenant', async () => {
      const { processor, db, prisma } = build();
      await processor.process(buildJob());
      expect((prisma.aiInteractionEvaluation as Record<string, unknown>).upsert).toBeUndefined();
      expect(db.api.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: { in: ['FAILED', 'PENDING'] } } }));
    });

    it('the reviewed race: a transient failure on the last attempt does not turn a completed evaluation into FAILED', async () => {
      const db = fakeEvaluations();
      const tasks = fakeTasks();
      const slow = gate();
      const a = build({ db, tasks }); // attempt 3 of 3: slow, then a transient error
      const b = build({ db, tasks }); // a second worker that completes first
      a.evaluator.evaluate.mockImplementation(async () => { await slow.promise; throw new TransientJudgeError('HTTP 503'); });
      b.evaluator.evaluate.mockResolvedValue(good);

      const runA = a.processor.process(buildJob({ attemptsMade: 2, attempts: 3 })); // passes the pre-check: no row yet
      await new Promise((r) => setImmediate(r));
      await b.processor.process(buildJob());                                         // B stores EVALUATED
      expect(db.rows.get('exec-1')).toMatchObject({ status: 'EVALUATED', overallScore: 5 });
      slow.open();
      await expect(runA).resolves.toBeUndefined();

      expect(db.rows.get('exec-1')).toMatchObject({ status: 'EVALUATED', overallScore: 5 });
      expect(db.rows.get('exec-1')?.evaluationError).toBeUndefined();
    });

    it('a permanent failure (null result) that loses the race does not overwrite the winner either', async () => {
      const db = fakeEvaluations();
      const slow = gate();
      const a = build({ db });
      const b = build({ db });
      a.evaluator.evaluate.mockImplementation(async () => { await slow.promise; return null; });
      const runA = a.processor.process(buildJob());
      await new Promise((r) => setImmediate(r));
      await b.processor.process(buildJob());
      slow.open();
      await runA;
      expect(db.rows.get('exec-1')).toMatchObject({ status: 'EVALUATED' });
    });

    it('a successful run does not overwrite an evaluation a human approved or rejected while it was calling the provider', async () => {
      for (const decision of ['APPROVED', 'REJECTED']) {
        const db = fakeEvaluations();
        const slow = gate();
        const { processor, evaluator } = build({ db });
        evaluator.evaluate.mockImplementation(async () => { await slow.promise; return good; });
        const run = processor.process(buildJob());
        await new Promise((r) => setImmediate(r));
        // While the provider call is in flight, the row appears and a reviewer settles it.
        db.rows.set('exec-1', { id: 'eval-win', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: decision, overallScore: 2, conversationId: 'conv-1', contactId: null, severity: null, failureCategories: [], evaluatorReasoning: null } as Row);
        slow.open();
        await expect(run).resolves.toBeUndefined();
        expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-win', status: decision, overallScore: 2 });
      }
    });

    it('two runs that both pass the pre-check: the first create wins, the second hits the unique index and writes nothing', async () => {
      const db = fakeEvaluations();
      const tasks = fakeTasks();
      const gA = gate(); const gB = gate();
      const a = build({ db, tasks }); const b = build({ db, tasks });
      a.evaluator.evaluate.mockImplementation(async () => { await gA.promise; return { ...good, overallScore: 1 }; });
      b.evaluator.evaluate.mockImplementation(async () => { await gB.promise; return { ...good, overallScore: 4 }; });
      const runA = a.processor.process(buildJob());
      const runB = b.processor.process(buildJob());
      await new Promise((r) => setImmediate(r));
      gB.open(); await runB;
      gA.open(); await expect(runA).resolves.toBeUndefined();
      expect(db.rows.size).toBe(1);
      expect(db.rows.get('exec-1')).toMatchObject({ overallScore: 4 }); // B's result stands
      expect(a.prisma.aiLearningAuditLog.create).not.toHaveBeenCalled(); // only the writer audits
      expect(b.prisma.aiLearningAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('a row owned by another tenant is never updated, and the run neither throws nor writes', async () => {
      // The pre-check is tenant-scoped, so it sees nothing; the conditional update is tenant-scoped, so it matches nothing; the
      // create hits the unique index. The other tenant's row is untouched either way.
      const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-OTHER', status: 'FAILED', evaluationError: 'theirs' }]);
      const { processor, evaluator } = build({ db });
      await expect(processor.process(buildJob())).resolves.toBeUndefined();
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      expect(db.rows.get('exec-1')).toMatchObject({ tenantId: 'tenant-OTHER', status: 'FAILED', evaluationError: 'theirs' });
    });

    describe('R2: a unique violation is not proof that a final evaluation won', () => {
      const warnSpy = (processor: unknown) => jest.spyOn((processor as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      const errorSpy = (processor: unknown) => jest.spyOn((processor as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);

      it('a FAILED competitor that appeared in the gap does not swallow the paid result: the guarded update is applied to it', async () => {
        const db = fakeEvaluations();
        const { processor, evaluator } = build({ db });
        const realCreate = db.api.create.getMockImplementation()!;
        // A failure recorded by another run lands between this run's updateMany and its create.
        db.api.create.mockImplementationOnce(async (args: never) => {
          db.rows.set('exec-1', { id: 'eval-f', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: 'FAILED', evaluationError: 'transient', conversationId: 'conv-1', contactId: 'contact-1', severity: null, failureCategories: [], evaluatorReasoning: null } as Row);
          return realCreate(args);
        });
        await processor.process(buildJob());
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(db.rows.size).toBe(1);
        expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-f', status: 'EVALUATED', overallScore: 5, evaluationError: null });
      });

      it('a PENDING competitor is handled the same way', async () => {
        const db = fakeEvaluations();
        const { processor } = build({ db });
        const realCreate = db.api.create.getMockImplementation()!;
        db.api.create.mockImplementationOnce(async (args: never) => {
          db.rows.set('exec-1', { id: 'eval-p', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: 'PENDING', conversationId: 'conv-1', contactId: 'contact-1', severity: null, failureCategories: [], evaluatorReasoning: null } as Row);
          return realCreate(args);
        });
        await processor.process(buildJob());
        expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-p', status: 'EVALUATED', overallScore: 5 });
      });

      it.each(['EVALUATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'])('a %s competitor is a lost race: nothing is overwritten and it is logged without any content', async (status) => {
        const db = fakeEvaluations();
        const { processor, evaluator } = build({ db });
        evaluator.evaluate.mockResolvedValue({ ...good, reasoning: 'SECRET-REASONING', dimensions: { accuracy: 5 } });
        const warn = warnSpy(processor);
        const realCreate = db.api.create.getMockImplementation()!;
        db.api.create.mockImplementationOnce(async (args: never) => {
          db.rows.set('exec-1', { id: 'eval-win', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status, overallScore: 2, conversationId: 'conv-1', contactId: 'contact-1', severity: null, failureCategories: [], evaluatorReasoning: 'winner' } as Row);
          return realCreate(args);
        });
        await expect(processor.process(buildJob())).resolves.toBeUndefined();
        expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-win', status, overallScore: 2, evaluatorReasoning: 'winner' });

        expect(warn).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(warn.mock.calls[0][0] as string);
        expect(logged).toMatchObject({ event: 'ai_learning.evaluation_write_lost', tenantId: 'tenant-1', aiExecutionId: 'exec-1', purpose: 'result', reason: 'final_evaluation_won', competingEvaluationId: 'eval-win', competingStatus: status });
        expect(warn.mock.calls[0][0]).not.toContain('SECRET-REASONING');
        expect(warn.mock.calls[0][0]).not.toContain('winner');
      });

      it('a conflict with a row in another tenant is never read or touched, and is logged as an anomaly', async () => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-OTHER', status: 'FAILED', evaluationError: 'theirs', evaluatorReasoning: 'their-private-text' }]);
        const { processor, evaluator } = build({ db });
        const error = errorSpy(processor);
        await expect(processor.process(buildJob())).resolves.toBeUndefined();
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(db.rows.get('exec-1')).toMatchObject({ tenantId: 'tenant-OTHER', status: 'FAILED', evaluationError: 'theirs' });
        expect(error).toHaveBeenCalledTimes(1);
        expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({ event: 'ai_learning.evaluation_write_lost', reason: 'unique_conflict_with_unreadable_row', tenantId: 'tenant-1' });
        expect(error.mock.calls[0][0]).not.toContain('their-private-text');
        // Every read and write was scoped to the job's tenant.
        for (const call of [...db.api.findFirst.mock.calls, ...db.api.updateMany.mock.calls]) {
          expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe('tenant-1');
        }
      });

      it('gives up after a bounded number of rounds when the competitor keeps changing, and lets the queue retry (it never loops forever)', async () => {
        const db = fakeEvaluations();
        const { processor } = build({ db });
        db.api.updateMany.mockResolvedValue({ count: 0 });                       // never matches
        db.api.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        db.api.findFirst.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => (select?.status ? { id: 'eval-f', status: 'FAILED' } : null));
        await expect(processor.process(buildJob())).rejects.toThrow(/kept changing/);
        expect(db.api.updateMany).toHaveBeenCalledTimes(3);
        expect(db.api.create).toHaveBeenCalledTimes(3);
      });

      it('a failure record that loses to a final evaluation is also logged (purpose: failure)', async () => {
        const db = fakeEvaluations();
        const { processor, evaluator } = build({ db });
        evaluator.evaluate.mockResolvedValue(null);
        const warn = warnSpy(processor);
        const realCreate = db.api.create.getMockImplementation()!;
        db.api.create.mockImplementationOnce(async (args: never) => {
          db.rows.set('exec-1', { id: 'eval-win', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: 'EVALUATED', overallScore: 5, conversationId: 'conv-1', contactId: 'contact-1', severity: null, failureCategories: [], evaluatorReasoning: null } as Row);
          return realCreate(args);
        });
        await processor.process(buildJob());
        expect(db.rows.get('exec-1')).toMatchObject({ status: 'EVALUATED' });
        expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ purpose: 'failure', reason: 'final_evaluation_won' });
      });
    });

    it('propagates a database error that is not a unique violation', async () => {
      const { processor, db } = build();
      db.api.create.mockRejectedValueOnce(new Error('db down'));
      await expect(processor.process(buildJob())).rejects.toThrow('db down');
    });

    it('propagates a failed conditional update', async () => {
      const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'FAILED' }]);
      const { processor } = build({ db });
      db.api.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(processor.process(buildJob())).rejects.toThrow('db down');
    });
  });

  describe('failed persistence', () => {
    it('propagates a failed write after the paid call so the queue retries it (never reports success)', async () => {
      const { processor, db, internalTasks, evaluator } = build();
      evaluator.evaluate.mockResolvedValue(critical);
      db.api.create.mockRejectedValue(new Error('db down'));
      await expect(processor.process(buildJob())).rejects.toThrow('db down');
      expect(internalTasks.create).not.toHaveBeenCalled();
    });

    it('propagates a failure to record a FAILED row, so the failure is not silently lost', async () => {
      const { processor, db, evaluator } = build();
      evaluator.evaluate.mockResolvedValue(null);
      db.api.create.mockRejectedValue(new Error('db down'));
      await expect(processor.process(buildJob())).rejects.toThrow('db down');
    });

    it('on the retry after a write that actually landed, the stored row prevents a second paid call', async () => {
      const { processor, db, evaluator } = build();
      db.api.create.mockImplementationOnce(async ({ data }: { data: { aiExecutionId: string } }) => {
        db.rows.set(data.aiExecutionId, { id: 'eval-landed', ...data, status: 'EVALUATED' } as unknown as Row);
        throw new Error('connection lost after commit');
      });
      await expect(processor.process(buildJob())).rejects.toThrow();
      await processor.process(buildJob({ attemptsMade: 1 }));
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe('disabled and invalid jobs make no provider call', () => {
    it('skips the job when AI learning is disabled for the tenant at processing time', async () => {
      const { processor, featureFlags, db, resolver, evaluator } = build();
      featureFlags.isEnabledCached.mockResolvedValue(false);
      await expect(processor.process(buildJob())).resolves.toBeUndefined();
      expect(featureFlags.isEnabledCached).toHaveBeenCalledWith('ai_learning_system', 'tenant-1');
      expect(db.api.findFirst).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(evaluator.evaluate).not.toHaveBeenCalled();
      expect(db.rows.size).toBe(0);
    });

    it('does not call the provider when the flag lookup fails (the job is retried instead)', async () => {
      const { processor, featureFlags, evaluator } = build();
      featureFlags.isEnabledCached.mockRejectedValue(new Error('db down'));
      await expect(processor.process(buildJob())).rejects.toThrow('db down');
      expect(evaluator.evaluate).not.toHaveBeenCalled();
    });

    it.each<[string, unknown]>([
      ['no data', undefined], ['null data', null], ['an empty object', {}],
      ['a missing tenantId', { aiExecutionId: 'exec-1' }], ['a missing aiExecutionId', { tenantId: 'tenant-1' }],
      ['empty strings', { aiExecutionId: '', tenantId: '' }], ['non-string ids', { aiExecutionId: 42, tenantId: { $ne: 'x' } }],
    ])('drops a job with %s without a database read, a retry or a provider call', async (_l, data) => {
      const { processor, featureFlags, db, resolver, evaluator } = build();
      await expect(processor.process(buildJob({ data }))).resolves.toBeUndefined();
      expect(featureFlags.isEnabledCached).not.toHaveBeenCalled();
      expect(db.api.findFirst).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(evaluator.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('review tasks for HIGH and CRITICAL evaluations', () => {
    it('creates a real InternalTask for a CRITICAL-severity evaluation', async () => {
      const { processor, internalTasks, evaluator } = build();
      evaluator.evaluate.mockResolvedValue(critical);
      await processor.process(buildJob());
      expect(internalTasks.create).toHaveBeenCalledTimes(1);
      expect(internalTasks.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ department: 'ai_review', priority: 'URGENT', conversationId: 'conv-1', contactId: 'contact-1', description: 'False payment claim' }));
    });

    it('creates a HIGH-priority task for a HIGH-severity evaluation', async () => {
      const { processor, internalTasks, evaluator } = build();
      evaluator.evaluate.mockResolvedValue({ ...critical, severity: 'HIGH' });
      await processor.process(buildJob());
      expect(internalTasks.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ priority: 'HIGH' }));
    });

    it('does not create a duplicate InternalTask when one already exists for this evaluation', async () => {
      const { processor, internalTasks, evaluator, internalTask } = build();
      evaluator.evaluate.mockResolvedValue(critical);
      internalTask.findFirst.mockResolvedValue({ id: 'task-1' });
      await processor.process(buildJob());
      expect(internalTasks.create).not.toHaveBeenCalled();
    });

    it('does not create an InternalTask for LOW/MEDIUM severity', async () => {
      const { processor, internalTasks, evaluator } = build();
      evaluator.evaluate.mockResolvedValue({ ...good, severity: 'LOW', failureCategories: ['TOO_VERBOSE'] });
      await processor.process(buildJob());
      expect(internalTasks.create).not.toHaveBeenCalled();
    });

    describe('R2: a missing task is recovered without another paid provider call', () => {
      it('a failed task lookup on a non-final attempt rethrows after the row is stored; the retry creates the task with no provider call', async () => {
        const { processor, db, evaluator, internalTask, internalTasks, tasks } = build();
        evaluator.evaluate.mockResolvedValue(critical);
        internalTask.findFirst.mockRejectedValueOnce(new Error('db blip'));

        await expect(processor.process(buildJob({ attemptsMade: 0 }))).rejects.toThrow('db blip');
        expect(db.rows.get('exec-1')).toMatchObject({ status: 'NEEDS_REVIEW', severity: 'CRITICAL' });
        expect(tasks).toHaveLength(0);

        await processor.process(buildJob({ attemptsMade: 1 })); // the retry

        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);     // no second paid call
        expect(internalTasks.create).toHaveBeenCalledTimes(1);
        expect(tasks[0]).toMatchObject({ priority: 'URGENT', description: 'False payment claim' });
        expect(tasks[0].title).toContain(String(db.rows.get('exec-1')?.id));
      });

      it('a failed task create is handled the same way as a failed lookup', async () => {
        const { processor, evaluator, internalTasks, tasks } = build();
        evaluator.evaluate.mockResolvedValue(critical);
        internalTasks.create.mockRejectedValueOnce(new Error('inbox down'));
        await expect(processor.process(buildJob({ attemptsMade: 0 }))).rejects.toThrow('inbox down');
        await processor.process(buildJob({ attemptsMade: 1 }));
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(tasks).toHaveLength(1);
      });

      it('on the LAST attempt a failed lookup is logged, not thrown (no endless failing job), and the stored evaluation stays', async () => {
        const { processor, db, evaluator, internalTask, tasks } = build();
        evaluator.evaluate.mockResolvedValue(critical);
        internalTask.findFirst.mockRejectedValueOnce(new Error('db blip'));
        const warn = jest.spyOn((processor as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
        await expect(processor.process(buildJob({ attemptsMade: 2, attempts: 3 }))).resolves.toBeUndefined();
        expect(db.rows.get('exec-1')).toMatchObject({ status: 'NEEDS_REVIEW' });
        expect(tasks).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('review task'));
      });

      it('the duplicate-evaluation path creates the missing task for a stored CRITICAL evaluation, with no provider or resolver call', async () => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', severity: 'CRITICAL', failureCategories: ['WRONG_PAYMENT_STATE'], evaluatorReasoning: 'False payment claim' }]);
        const { processor, evaluator, resolver, internalTasks, tasks } = build({ db });
        await processor.process(buildJob());
        expect(evaluator.evaluate).not.toHaveBeenCalled();
        expect(resolver.resolve).not.toHaveBeenCalled();
        expect(internalTasks.create).toHaveBeenCalledTimes(1);
        expect(tasks[0]).toMatchObject({ priority: 'URGENT', description: 'False payment claim', conversationId: 'conv-1', contactId: 'contact-1' });
        expect(tasks[0].title).toContain('eval-seed-1');
      });

      it('falls back to the failure categories when the stored reasoning is empty', async () => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', severity: 'HIGH', failureCategories: ['A', 'B'], evaluatorReasoning: '' }]);
        const { processor, tasks } = build({ db });
        await processor.process(buildJob());
        expect(tasks[0]).toMatchObject({ priority: 'HIGH', description: 'A, B' });
      });

      it('is idempotent: repeated deliveries create exactly one task', async () => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', severity: 'CRITICAL', evaluatorReasoning: 'x' }]);
        const { processor, tasks } = build({ db });
        await processor.process(buildJob());
        await processor.process(buildJob());
        await processor.process(buildJob());
        expect(tasks).toHaveLength(1);
      });

      it('does not create a task for an evaluation a human has already approved or rejected', async () => {
        for (const status of ['APPROVED', 'REJECTED']) {
          const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status, severity: 'CRITICAL', evaluatorReasoning: 'x' }]);
          const { processor, internalTasks } = build({ db });
          await processor.process(buildJob());
          expect(internalTasks.create).not.toHaveBeenCalled();
        }
      });

      it.each([['LOW'], ['MEDIUM'], [null]])('does not create a task on the duplicate path for severity %s', async (severity) => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'EVALUATED', severity }]);
        const { processor, internalTasks } = build({ db });
        await processor.process(buildJob());
        expect(internalTasks.create).not.toHaveBeenCalled();
      });

      it('does not create a task for another tenant\'s evaluation of the same execution id', async () => {
        const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-OTHER', status: 'NEEDS_REVIEW', severity: 'CRITICAL', evaluatorReasoning: 'x' }]);
        const { processor, internalTasks } = build({ db });
        await processor.process(buildJob());
        expect(internalTasks.create).not.toHaveBeenCalled();
      });

      describe('R3: the task step runs in a transaction that locks the evaluation row', () => {
        const seeded = () => fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', severity: 'CRITICAL', evaluatorReasoning: 'x' }]);

        it('locks the evaluation (by id AND tenant) before looking for or creating the task, all inside one transaction', async () => {
          const db = seeded();
          const { processor, events, prisma } = build({ db });
          await processor.process(buildJob());
          expect(prisma.$transaction).toHaveBeenCalledTimes(1);
          expect(db.lock.calls).toEqual([{ id: 'eval-seed-1', tenantId: 'tenant-1' }]);
          expect(events[0]).toContain('begin:');
          expect(events.slice(1)).toEqual(['task-create', 'end']);
        });

        it('the lock statement is a parameterised SELECT ... FOR UPDATE on the evaluation row, scoped by id and tenant (static text check; the database behaviour itself is covered by the Postgres integration spec)', async () => {
          const db = seeded();
          const { processor } = build({ db });
          await processor.process(buildJob());
          expect(db.lock.sql).toEqual(['SELECT status::text AS status FROM ai_interaction_evaluations WHERE id = ? AND tenant_id = ? FOR UPDATE']);
        });

        it('uses the transaction client for the lock and the lookup, not the shared client', async () => {
          const db = seeded();
          const { processor, internalTask } = build({ db });
          await processor.process(buildJob());
          expect(db.queryRaw).toHaveBeenCalledTimes(1);
          expect(internalTask.findFirst).toHaveBeenCalledTimes(1);
        });

        it('an approval that committed after the snapshot was read is seen under the lock: no task is created for a reviewed evaluation', async () => {
          for (const decided of ['APPROVED', 'REJECTED']) {
            const db = seeded();
            db.lock.override = decided; // the row says NEEDS_REVIEW in the snapshot, but the locked read sees the decision
            const { processor, internalTasks, internalTask } = build({ db });
            await processor.process(buildJob());
            expect(internalTasks.create).not.toHaveBeenCalled();
            expect(internalTask.findFirst).not.toHaveBeenCalled();
          }
        });

        it('creates nothing when the evaluation is gone or belongs to another tenant at lock time', async () => {
          const db = seeded();
          db.lock.override = null;
          const { processor, internalTasks } = build({ db });
          await processor.process(buildJob());
          expect(internalTasks.create).not.toHaveBeenCalled();
        });

        it('takes no lock and opens no transaction for severities that never get a task, or for already-reviewed snapshots', async () => {
          for (const [status, severity] of [['EVALUATED', 'LOW'], ['EVALUATED', null], ['APPROVED', 'CRITICAL']] as const) {
            const db = fakeEvaluations([{ aiExecutionId: 'exec-1', tenantId: 'tenant-1', status, severity }]);
            const { processor, prisma } = build({ db });
            await processor.process(buildJob());
            expect(prisma.$transaction).not.toHaveBeenCalled();
          }
        });

        it('a failure inside the transaction (lock, lookup or create) propagates, so the retry can recover the task', async () => {
          const db = seeded();
          const { processor, tasks } = build({ db });
          db.queryRaw.mockRejectedValueOnce(new Error('lock timeout'));
          await expect(processor.process(buildJob({ attemptsMade: 0 }))).rejects.toThrow('lock timeout');
          await processor.process(buildJob({ attemptsMade: 1 }));
          expect(tasks).toHaveLength(1);
        });

        it('requests a transaction timeout long enough for the lock wait and the notification', async () => {
          const { processor, events } = build({ db: seeded() });
          await processor.process(buildJob());
          expect(JSON.parse(events[0].slice('begin:'.length))).toEqual({ maxWait: 10000, timeout: 20000 });
        });
      });

      it('a run that loses the write race still makes sure the winning CRITICAL evaluation has its task', async () => {
        const db = fakeEvaluations();
        const tasks = fakeTasks();
        const slow = gate();
        const loser = build({ db, tasks });
        loser.evaluator.evaluate.mockImplementation(async () => { await slow.promise; return good; });
        const run = loser.processor.process(buildJob());
        await new Promise((r) => setImmediate(r));
        // The winner stored a CRITICAL evaluation but never got to create its task.
        db.rows.set('exec-1', { id: 'eval-win', tenantId: 'tenant-1', aiExecutionId: 'exec-1', status: 'NEEDS_REVIEW', conversationId: 'conv-1', contactId: 'contact-1', severity: 'CRITICAL', failureCategories: [], evaluatorReasoning: 'winner' } as Row);
        slow.open();
        await run;
        expect(db.rows.get('exec-1')).toMatchObject({ id: 'eval-win', evaluatorReasoning: 'winner' });
        expect(tasks.tasks).toHaveLength(1);
        expect(tasks.tasks[0].title).toContain('eval-win');
      });
    });
  });
});
