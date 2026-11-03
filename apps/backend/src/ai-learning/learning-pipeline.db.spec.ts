/**
 * The whole evaluation chain on a real PostgreSQL: the REAL processor, evaluator, provider registry/adapter, cost ledger and settings. Only
 * the HTTP call to the provider is mocked, so the number of provider calls is observable. It proves that nothing is sent to the provider
 * unless the workspace has opted in, is not paused and has acknowledged the CURRENT notice; that a permitted run is reserved, settled with
 * the provider-reported usage and stored once; that redelivery does not pay twice; that customer AI credits are untouched; and that no
 * tenant credential ever reaches the provider request.
 */
import axios from 'axios';
import { AiInteractionEvalProcessor } from './ai-interaction-eval.processor';
import { AiInteractionEvaluatorService } from './ai-interaction-evaluator.service';
import { AiLearningCostService } from './learning-cost.service';
import { AiLearningSettingsService } from './learning-settings.service';
import { currentDisclosureVersion } from './learning-disclosure';
import { costMicros } from './pricing/learning-price-table';
import { DeepSeekProvider } from '../ai-core/providers/deepseek.provider';
import { ProviderRegistryService } from '../ai-core/providers/provider-registry.service';
import { ResolvedInteractionContext } from './interaction-context.resolver';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);

const WA_TOKEN = 'WA-ACCESS-TOKEN-do-not-leak-4f9c1';
const DEEPSEEK_KEY = 'test-deepseek-key';
const JUDGE_ANSWER = JSON.stringify({ dimensions: { accuracy: 5, naturalness: 4 }, failureCategories: [], reasoning: 'Fine.', confidence: 0.9, falseActionClaim: false, falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false });

dbSuite('The evaluation chain end to end (real PostgreSQL; only the provider HTTP call is mocked)', () => {
  const originalKey = process.env['DEEPSEEK_API_KEY'];
  beforeAll(() => { process.env['DEEPSEEK_API_KEY'] = DEEPSEEK_KEY; });
  afterAll(async () => { if (originalKey === undefined) delete process.env['DEEPSEEK_API_KEY']; else process.env['DEEPSEEK_API_KEY'] = originalKey; await fx.cleanup(); await prisma.$disconnect(); }, 120_000);
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ data: { model: 'deepseek-v4-flash', choices: [{ message: { content: JUDGE_ANSWER }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 120 } } });
  });

  function build(costConfig?: { workspaceMonthlyBudgetMicros: bigint; globalMonthlyBudgetMicros: bigint; maxReservationMicros: bigint }) {
    const cost = new AiLearningCostService(prisma as never, costConfig ?? { workspaceMonthlyBudgetMicros: 10n ** 9n, globalMonthlyBudgetMicros: 10n ** 12n, maxReservationMicros: 10n ** 7n });
    const evaluator = new AiInteractionEvaluatorService(new ProviderRegistryService(new DeepSeekProvider()), cost);
    const resolver = { resolve: jest.fn() };
    const processor = new AiInteractionEvalProcessor(prisma as never, resolver as never, evaluator, { create: jest.fn() } as never, { isEnabledCached: async () => true } as never);
    const settings = new AiLearningSettingsService(prisma as never, cost);
    return { processor, resolver, settings, cost };
  }

  /** A workspace with an AI turn to grade. `state` decides what the workspace has agreed to. */
  async function workspace(state: 'never-opted-in' | 'opted-in' | 'paused' | 'outdated-notice' | 'notice-not-acknowledged') {
    const tenantId = await fx.tenant();
    await prisma.tenant.update({ where: { id: tenantId }, data: { accessToken: WA_TOKEN, phoneNumberId: '1234567890', aiCredits: 777 } });
    if (state !== 'never-opted-in') {
      await prisma.aiLearningSettings.create({
        data: {
          tenantId, learningEnabled: true, learningPaused: state === 'paused',
          disclosureVersion: state === 'outdated-notice' ? 'd1-000000000000' : state === 'notice-not-acknowledged' ? null : currentDisclosureVersion(),
        },
      });
    }
    return tenantId;
  }
  async function turn(tenantId: string) {
    const { conversation, contact } = await fx.conversation(tenantId);
    const execution = await prisma.aiExecution.create({ data: { tenantId, conversationId: conversation.id, taskType: 'RESPONDER', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'SUCCESS' } });
    const ctx: ResolvedInteractionContext = {
      conversationId: conversation.id, contactId: contact.id, customerMessage: 'Do you deliver to Kumasi on Sunday?', aiResponse: 'Yes, we deliver every day.',
      priorContext: [{ direction: 'INBOUND', content: 'Hello', createdAt: new Date() }], latestOrderStatus: null, handoffTaskExists: false, humanOwned: false, conversationStatus: 'OPEN',
    };
    return { execution, ctx };
  }
  const job = (tenantId: string, aiExecutionId: string) => ({ data: { tenantId, aiExecutionId }, attemptsMade: 0, opts: { attempts: 3 } }) as never;
  const usageRows = (tenantId: string) => prisma.aiLearningUsage.findMany({ where: { tenantId } });

  describe.each([
    ['a workspace that never opted in', 'never-opted-in'],
    ['an opted-in workspace that is PAUSED', 'paused'],
    ['an opted-in workspace whose notice acknowledgement is OUTDATED', 'outdated-notice'],
    ['an opted-in workspace that never acknowledged the notice', 'notice-not-acknowledged'],
  ] as const)('%s', (_label, state) => {
    it('sends NOTHING to the provider, stores no evaluation and creates no ledger row', async () => {
      const tenantId = await workspace(state);
      const { processor, resolver } = build();
      const { execution, ctx } = await turn(tenantId);
      resolver.resolve.mockResolvedValue(ctx);

      await processor.process(job(tenantId, execution.id));

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(await prisma.aiInteractionEvaluation.count({ where: { tenantId } })).toBe(0);
      expect(await usageRows(tenantId)).toHaveLength(0);
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).aiCredits).toBe(777);
    });
  });

  describe('a permitted workspace (opted in, not paused, current notice acknowledged)', () => {
    it('reserves, calls the provider ONCE, settles with the provider-reported usage, stores the evaluation, and leaves customer credits alone', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver } = build();
      const { execution, ctx } = await turn(tenantId);
      resolver.resolve.mockResolvedValue(ctx);

      await processor.process(job(tenantId, execution.id));

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const evaluation = await prisma.aiInteractionEvaluation.findFirstOrThrow({ where: { tenantId } });
      expect(evaluation).toMatchObject({ aiExecutionId: execution.id, status: 'EVALUATED' });
      const [row] = await usageRows(tenantId);
      expect(row).toMatchObject({ state: 'COMPLETED', runNo: 1, inputTokens: 900, outputTokens: 120, actualMicros: costMicros(900, 120) });
      expect(row!.actualMicros).toBe(414n); // 900 x 0.30 + 120 x 1.20 micro-USD
      expect(row!.reservedMicros).toBeGreaterThan(row!.actualMicros!); // the estimate is an upper bound
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.aiCredits).toBe(777);
      expect(await prisma.aiCreditTransaction.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.aiCreditReservation.count({ where: { tenantId } })).toBe(0);
    });

    it('a redelivered job does not pay a second time', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver } = build();
      const { execution, ctx } = await turn(tenantId);
      resolver.resolve.mockResolvedValue(ctx);

      await processor.process(job(tenantId, execution.id));
      await processor.process(job(tenantId, execution.id));

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(await usageRows(tenantId)).toHaveLength(1);
    });

    it('stops at the workspace cap EXACTLY: a second turn that would exceed it by one micro-USD is not sent, and the denial is recorded at no cost', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver, cost } = build();
      const first = await turn(tenantId);
      const second = await turn(tenantId);
      resolver.resolve.mockResolvedValue(first.ctx);
      await processor.process(job(tenantId, first.execution.id));
      const [done] = await usageRows(tenantId);
      expect(done).toMatchObject({ state: 'COMPLETED', actualMicros: 414n });
      // The second reservation is the same size as the first; what is already counted is the first's real cost (414). Set the cap one micro-USD short.
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { monthlyBudgetMicros: 414n + done!.reservedMicros - 1n } });

      resolver.resolve.mockResolvedValue(second.ctx);
      await processor.process(job(tenantId, second.execution.id));

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const skipped = (await usageRows(tenantId)).filter((r) => r.aiExecutionId === second.execution.id);
      expect(skipped).toMatchObject([{ state: 'SKIPPED', skipReason: 'workspace_cap', reservedMicros: 0n }]);
      expect(await prisma.aiInteractionEvaluation.count({ where: { aiExecutionId: second.execution.id } })).toBe(0);
      expect((await cost.summary(tenantId)).workspaceMicros).toBe(414n);

      // One micro-USD more headroom and the same turn is allowed.
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { monthlyBudgetMicros: 414n + done!.reservedMicros } });
      const third = await turn(tenantId);
      resolver.resolve.mockResolvedValue(third.ctx);
      await processor.process(job(tenantId, third.execution.id));
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('pausing takes effect for the very next turn', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver, settings } = build();
      const a = await turn(tenantId);
      const b = await turn(tenantId);
      resolver.resolve.mockResolvedValue(a.ctx);
      await processor.process(job(tenantId, a.execution.id));
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      const admin = await fx.user(tenantId);
      await settings.update(tenantId, admin.id, { learningPaused: true });
      resolver.resolve.mockResolvedValue(b.ctx);
      await processor.process(job(tenantId, b.execution.id));

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(await prisma.aiInteractionEvaluation.count({ where: { tenantId } })).toBe(1);
    });

    it('a changed notice stops the very next turn, and acknowledging the new one restarts it', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver, settings } = build();
      const admin = await fx.user(tenantId);
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true'; // the notice describes retention, so this is a new version
      try {
        const a = await turn(tenantId);
        resolver.resolve.mockResolvedValue(a.ctx);
        await processor.process(job(tenantId, a.execution.id));
        expect(mockedAxios.post).not.toHaveBeenCalled();

        await settings.update(tenantId, admin.id, { acknowledgedDisclosureVersion: currentDisclosureVersion() });
        const b = await turn(tenantId);
        resolver.resolve.mockResolvedValue(b.ctx);
        await processor.process(job(tenantId, b.execution.id));
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      } finally { delete process.env['AI_LEARNING_RETENTION_ENABLED']; }
    });

    it('no tenant credential, phone number id or internal id reaches the provider request body', async () => {
      const tenantId = await workspace('opted-in');
      const { processor, resolver } = build();
      const { execution, ctx } = await turn(tenantId);
      resolver.resolve.mockResolvedValue(ctx);

      await processor.process(job(tenantId, execution.id));

      const [url, body, config] = mockedAxios.post.mock.calls[0]!;
      const sent = JSON.stringify(body);
      expect(sent).not.toContain(WA_TOKEN);
      expect(sent).not.toContain('1234567890');
      expect(sent).not.toContain(tenantId);
      expect(sent).not.toContain(execution.id);
      expect(String(url)).toMatch(/^https:\/\/api\.deepseek\.com\//);
      // The only credential in the request is the provider's own key, in the Authorization header, which is not logged anywhere.
      expect(JSON.stringify((config as { headers?: unknown }).headers)).toContain(DEEPSEEK_KEY);
    });
  });
});
