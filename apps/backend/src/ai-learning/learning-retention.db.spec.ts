import { randomUUID } from 'crypto';
import { AiLearningRetentionService, RETENTION_MANIFEST } from './learning-retention.service';
import { isolatedDbSuite, makeFixtures, newIsolatedTestClient } from './testing/db-test-env';

// The sweep is platform-wide by nature (it acts on every workspace's old rows), so it runs in a database no other suite writes to.
const prisma = newIsolatedTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const TEXT = 'customer said 4111-SECRET at 12 Palm Street';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

isolatedDbSuite('AiLearningRetentionService against a real PostgreSQL (isolated database)', () => {
  const service = prisma ? new AiLearningRetentionService(prisma as never) : (undefined as unknown as AiLearningRetentionService);
  const ENV_KEYS = ['AI_LEARNING_RETENTION_ENABLED', 'AI_LEARNING_RETENTION_FREE_TEXT_DAYS', 'AI_LEARNING_RETENTION_METRICS_MONTHS'];
  afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });
  const enable = () => { process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true'; };

  /** A full learning record set for one conversation, every row created `age` days ago. */
  async function record(tenantId: string, age: number, example: 'APPROVED' | 'DRAFT' | 'NONE') {
    const { conversation } = await fx.conversation(tenantId);
    const reviewer = await fx.user(tenantId, 'rev');
    const at = daysAgo(age);
    const execution = await prisma.aiExecution.create({ data: { tenantId, conversationId: conversation.id, taskType: 'RESPONDER', provider: 'deepseek', modelKey: 'm', status: 'SUCCESS', inputTokens: 10, outputTokens: 5, toolTrace: [{ x: TEXT }], errorMessage: TEXT, createdAt: at } });
    const log = await prisma.aiInteractionLog.create({ data: { tenantId, conversationId: conversation.id, customerMessage: TEXT, aiResponse: TEXT, finalSentMessage: TEXT, feedbackNote: TEXT, status: 'APPROVED', confidenceScore: 0.9, feedbackRating: 4, createdAt: at } });
    const evaluation = await prisma.aiInteractionEvaluation.create({ data: { tenantId, conversationId: conversation.id, aiExecutionId: execution.id, status: 'EVALUATED', overallScore: 4.2, evaluatorReasoning: TEXT, evaluationError: TEXT, createdAt: at } });
    const feedback = await prisma.aiEvaluationFeedback.create({ data: { evaluationId: evaluation.id, tenantId, reviewerId: reviewer.id, rating: 'BAD', notes: TEXT, expectedAction: TEXT, expectedResponse: TEXT, createdAt: at } });
    const correction = await prisma.aiCustomerCorrection.create({ data: { tenantId, evaluationId: evaluation.id, correctionMessageId: randomUUID(), reviewerNotes: TEXT, expectedInterpretation: TEXT, createdAt: at } });
    const trainingExample = example === 'NONE' ? null : await prisma.aiTrainingExample.create({ data: { tenantId, sourceEvaluationId: evaluation.id, sourceConversationId: conversation.id, customerInput: TEXT, actualResponse: TEXT, expectedResponse: TEXT, status: example, approvedAt: example === 'APPROVED' ? at : null, createdAt: at } });
    const task = await prisma.internalTask.create({ data: { tenantId, department: 'ai_review', title: 't', description: TEXT, conversationId: conversation.id, createdAt: at } });
    const otherTask = await prisma.internalTask.create({ data: { tenantId, department: 'support', title: 't2', description: TEXT, createdAt: at } });
    return { execution, log, evaluation, feedback, correction, trainingExample, task, otherTask };
  }
  const gone = async (r: Awaited<ReturnType<typeof record>>) => ({
    log: await prisma.aiInteractionLog.findUnique({ where: { id: r.log.id } }),
    evaluation: await prisma.aiInteractionEvaluation.findUnique({ where: { id: r.evaluation.id } }),
    feedback: await prisma.aiEvaluationFeedback.findUnique({ where: { id: r.feedback.id } }),
    correction: await prisma.aiCustomerCorrection.findUnique({ where: { id: r.correction.id } }),
    example: r.trainingExample ? await prisma.aiTrainingExample.findUnique({ where: { id: r.trainingExample.id } }) : null,
    task: await prisma.internalTask.findUnique({ where: { id: r.task.id } }),
    otherTask: await prisma.internalTask.findUnique({ where: { id: r.otherTask.id } }),
    execution: await prisma.aiExecution.findUniqueOrThrow({ where: { id: r.execution.id } }),
  });

  it('does NOTHING while disabled (the default): old records are byte-for-byte unchanged', async () => {
    const tenantId = await fx.tenant();
    const r = await record(tenantId, 800, 'DRAFT');
    const before = JSON.stringify(await gone(r));

    await expect(service.run()).resolves.toEqual({ enabled: false });

    expect(JSON.stringify(await gone(r))).toBe(before);
  });

  it('with retention enabled, ages out free text after 90 days and keeps the metrics', async () => {
    enable();
    const tenantId = await fx.tenant();
    const young = await record(tenantId, 10, 'NONE');
    const old = await record(tenantId, 100, 'NONE');

    const result = await service.run();
    expect(result).toMatchObject({ enabled: true });

    const y = await gone(young);
    expect(y.log).toMatchObject({ customerMessage: TEXT, aiResponse: TEXT }); // 10 days: untouched
    expect(y.execution.errorMessage).toBe(TEXT);
    expect(y.task?.description).toBe(TEXT);

    const o = await gone(old);
    expect(o.log).toMatchObject({ customerMessage: '', aiResponse: '', finalSentMessage: null, feedbackNote: null, status: 'APPROVED', confidenceScore: 0.9, feedbackRating: 4 });
    expect(o.evaluation).toMatchObject({ evaluatorReasoning: null, evaluationError: null, status: 'EVALUATED', overallScore: 4.2 });
    expect(o.feedback).toMatchObject({ notes: null, expectedAction: null, expectedResponse: null, rating: 'BAD' });
    expect(o.correction).toMatchObject({ reviewerNotes: null, expectedInterpretation: null });
    expect(o.task).toMatchObject({ description: null, title: 't' });
    expect(o.otherTask?.description).toBe(TEXT); // not an ai_review task
    expect(o.execution).toMatchObject({ toolTrace: null, errorMessage: null, inputTokens: 10, outputTokens: 5, status: 'SUCCESS' });
  });

  it('NEVER touches approved guidance or the evaluation behind it, however old', async () => {
    enable();
    const tenantId = await fx.tenant();
    const approved = await record(tenantId, 900, 'APPROVED');

    await service.run();

    const a = await gone(approved);
    expect(a.example).toMatchObject({ status: 'APPROVED', customerInput: TEXT, expectedResponse: TEXT });
    expect(a.evaluation).toMatchObject({ evaluatorReasoning: TEXT }); // text behind approved guidance is kept
    expect(a.feedback).toMatchObject({ notes: TEXT, expectedResponse: TEXT });
    expect(a.correction).toMatchObject({ reviewerNotes: TEXT });
  });

  it('deletes un-approved examples after 90 days, and metrics rows after 13 months only when no example refers to them', async () => {
    enable();
    const tenantId = await fx.tenant();
    const draft100 = await record(tenantId, 100, 'DRAFT');
    const draft10 = await record(tenantId, 10, 'DRAFT');
    const none500 = await record(tenantId, 500, 'NONE');
    const approved500 = await record(tenantId, 500, 'APPROVED');

    await service.run();

    expect((await gone(draft100)).example).toBeNull(); // the un-approved example is gone at 90 days...
    expect((await gone(draft100)).evaluation).not.toBeNull(); // ...its evaluation row (metrics) stays until 13 months
    expect((await gone(draft10)).example).not.toBeNull();
    const n = await gone(none500);
    expect([n.log, n.evaluation, n.feedback, n.correction]).toEqual([null, null, null, null]); // 13 months: metrics rows removed (feedback and corrections cascade)
    const a = await gone(approved500);
    expect(a.log).toBeNull(); // the blanked log row is metrics: removed at 13 months
    expect(a.evaluation).not.toBeNull(); // but an evaluation that backs an example is kept
    expect(a.example).not.toBeNull();
  });

  it('changes ONLY the columns the manifest names: a full-row diff of every learning table', async () => {
    enable();
    const tenantId = await fx.tenant();
    const r = await record(tenantId, 100, 'DRAFT');
    const snap = async () => ({
      ai_interaction_logs: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ai_interaction_logs WHERE id = ${r.log.id}`,
      ai_interaction_evaluations: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ai_interaction_evaluations WHERE id = ${r.evaluation.id}`,
      ai_evaluation_feedback: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ai_evaluation_feedback WHERE id = ${r.feedback.id}`,
      ai_customer_corrections: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ai_customer_corrections WHERE id = ${r.correction.id}`,
      internal_tasks: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM internal_tasks WHERE id = ${r.task.id}`,
      ai_executions: await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ai_executions WHERE id = ${r.execution.id}`,
    });
    const before = await snap();

    await service.run();
    const after = await snap();

    for (const table of Object.keys(before) as Array<keyof typeof before>) {
      const allowed = new Set<string>(RETENTION_MANIFEST.filter((m) => m.table === table).flatMap((m) => [...m.columns, ...('alsoNull' in m ? m.alsoNull : [])]));
      const changed = Object.keys(before[table][0]!).filter((c) => JSON.stringify(before[table][0]![c], (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) !== JSON.stringify(after[table][0]![c], (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      expect(changed.length).toBeGreaterThan(0);
      for (const column of changed) expect({ table, column, allowed: allowed.has(column) }).toEqual({ table, column, allowed: true });
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    enable();
    const tenantId = await fx.tenant();
    await record(tenantId, 100, 'DRAFT');
    await service.run();

    const second = await service.run();

    expect(second).toMatchObject({ enabled: true });
    if (second.enabled) {
      // Other suites may add old rows concurrently, but the rows made here are done; none of the in-scope rules has work from this tenant.
      expect(await prisma.aiInteractionLog.count({ where: { tenantId, OR: [{ customerMessage: { not: '' } }, { aiResponse: { not: '' } }] } })).toBe(0);
    }
  });

  it('works through more rows than one batch (2,100 old logs)', async () => {
    enable();
    const tenantId = await fx.tenant();
    const { conversation } = await fx.conversation(tenantId);
    await prisma.$executeRaw`INSERT INTO ai_interaction_logs (id, tenant_id, conversation_id, customer_message, ai_response, status, edited_by_agent, created_at)
      SELECT gen_random_uuid()::text, ${tenantId}, ${conversation.id}, 'q', 'a', 'SUGGESTED', false, (clock_timestamp() AT TIME ZONE 'UTC') - interval '120 days' FROM generate_series(1, 2100)`;

    await service.run();

    expect(await prisma.aiInteractionLog.count({ where: { conversationId: conversation.id, customerMessage: '' } })).toBe(2100);
    expect(await prisma.aiInteractionLog.count({ where: { conversationId: conversation.id, customerMessage: 'q' } })).toBe(0);
  });

  it('honours configured periods', async () => {
    enable();
    process.env['AI_LEARNING_RETENTION_FREE_TEXT_DAYS'] = '5';
    const tenantId = await fx.tenant();
    const r = await record(tenantId, 10, 'NONE');

    await service.run();

    expect((await gone(r)).log?.customerMessage).toBe('');
  });
});
