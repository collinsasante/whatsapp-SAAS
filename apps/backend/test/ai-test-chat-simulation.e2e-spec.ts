import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { AiExecutionsService } from '../src/ai-core/executions/ai-executions.service';
import { AiInteractionEvalProcessor } from '../src/ai-learning/ai-interaction-eval.processor';
import { AiLearningTriggerService } from '../src/ai-learning/ai-learning-trigger.service';
import { InteractionContextResolver } from '../src/ai-learning/interaction-context.resolver';
import { AiTestChatService } from '../src/ai-core/test-chat/ai-test-chat.service';
import { MemorySimulationStore } from '../src/ai-core/simulation/simulation-store';
import { SimulationLimitsService } from '../src/ai-core/simulation/simulation-limits.service';
import { AiLogsService } from '../src/ai-logs/ai-logs.service';
import { MessagesService } from '../src/messages/messages.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * AI Test Chat simulation against a REAL PostgreSQL: the real MessagesService reply path, real persistence, the real execution
 * recorder, the real evaluation trigger and the real evaluation processor. The ONLY stand-ins are the AI provider (a fixed reply)
 * and every messaging provider, each of which is a spy that records any call, so "nothing was sent" is observed, not assumed.
 *
 * SAFETY: creates and deletes rows. Runs ONLY when AI_LEARNING_PG_TESTS=1 AND DATABASE_URL is on localhost with a database name
 * containing "test"; otherwise the whole suite is skipped. Never truncates; deletes only the tenants it created. No AI provider
 * and no messaging provider is ever contacted.
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

/** A provider stand-in that records every method called on it and never does anything. */
function providerSpy(log: string[], label: string) {
  return new Proxy({}, { get: (_t, name) => (...args: unknown[]) => { log.push(`${label}.${String(name)}`); void args; return Promise.resolve('wamid.should-never-exist'); } });
}

suite('AI Test Chat simulation against a real PostgreSQL (disposable database only)', () => {
  jest.setTimeout(60_000);

  let prisma: PrismaClient;
  const tenantIds: string[] = [];

  beforeAll(async () => { prisma = new PrismaClient(); await prisma.$connect(); });
  afterEach(async () => { if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function seed(phone: string) {
    const tenant = await prisma.tenant.create({ data: { name: `sim-it ${randomUUID().slice(0, 8)}`, webhookVerifyToken: randomUUID() } });
    tenantIds.push(tenant.id);
    const contact = await prisma.contact.create({ data: { tenantId: tenant.id, phone, name: 'Customer' } });
    const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN' } });
    await prisma.message.create({ data: { tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', type: 'TEXT', status: 'DELIVERED', content: 'How much is delivery?' } });
    return { tenant, contact, conversation };
  }

  function build(opts: { reply?: { response: string; confidence: number; blocked?: boolean; shouldEscalate?: boolean } } = {}) {
    const providerCalls: string[] = [];
    const creditCalls: string[] = [];
    const handoffs: string[] = [];
    const queued: Array<{ name: string; data: { aiExecutionId: string; tenantId: string }; opts: { jobId?: string } }> = [];
    // Only AI Learning is on. verz_ai_v2 stays off, so the legacy responder (which this spec stubs) answers.
    const featureFlags = { isEnabledCached: async (key: string) => key === 'ai_learning_system' };
    const trigger = new AiLearningTriggerService(featureFlags as never, { add: async (name: string, data: never, o: never) => { queued.push({ name, data, opts: o }); } } as never);
    const executions = new AiExecutionsService(
      prisma as unknown as PrismaService,
      { settleForExecution: async () => { creditCalls.push('settleForExecution'); }, linkReservationsToExecution: async () => { creditCalls.push('linkReservations'); } } as never,
      { getCreditsForUsage: async () => { creditCalls.push('getCreditsForUsage'); return 1; } } as never,
      trigger,
    );
    const aiCredits = new Proxy({}, { get: (_t, name) => async () => { creditCalls.push(String(name)); return { id: 'reservation-1', settled: true, transaction: null }; } });
    const reply = opts.reply ?? { response: 'Delivery to Accra is GHS 30.', confidence: 90 };
    const responder = {
      findOrCreateVerzAgent: async () => null,
      generateSuggestion: async (_t: string, _c: string, _m: string, _n: unknown, wrapper?: <T>(call: () => Promise<T>) => Promise<T>) => {
        if (wrapper) await wrapper(() => Promise.resolve({ data: { usage: { prompt_tokens: 120, completion_tokens: 30 } } }));
        return { response: reply.response, confidence: reply.confidence, blocked: !!reply.blocked, shouldEscalate: reply.shouldEscalate };
      },
    };
    const conversationsService = { requestWithRetry: async () => { handoffs.push('requestWithRetry'); return true; }, request: async () => { handoffs.push('request'); return null; } };
    const noop = {};
    const service = new MessagesService(
      prisma as unknown as PrismaService, providerSpy(providerCalls, 'whatsapp') as never, conversationsService as never, noop as never,
      { emitNewMessage: () => undefined, emitAiSuggestion: () => undefined, emitConversationUpdated: () => undefined } as never, noop as never,
      noop as never, noop as never, responder as never, noop as never, new AiLogsService(prisma as unknown as PrismaService) as never, noop as never,
      featureFlags as never, noop as never, noop as never, executions, { scoreConversation: async () => { creditCalls.push('scoreConversation'); } } as never,
      aiCredits as never, { getState: async () => null, mergeState: async () => undefined } as never,
      providerSpy(providerCalls, 'messenger') as never, providerSpy(providerCalls, 'whatsappWeb') as never,
    );
    return { service, providerCalls, creditCalls, handoffs, queued, executions, featureFlags };
  }

  const reply = (service: MessagesService, seeded: Awaited<ReturnType<typeof seed>>, mode: 'auto' | 'suggest' = 'auto') => {
    const args = [seeded.tenant.id, { id: seeded.conversation.id, whatsappNumberId: null, channel: null }, { id: seeded.contact.id, phone: seeded.contact.phone, name: seeded.contact.name }];
    const s = service as unknown as Record<string, (...a: unknown[]) => Promise<void>>;
    return mode === 'auto' ? s.handleAiAutoReply(...args, 'How much is delivery?', false, null) : s.handleAiSuggestion(...args, 'How much is delivery?', false);
  };

  it('a simulated auto-reply is stored as SIMULATED, nothing reaches any provider, and no credits move', async () => {
    const seeded = await seed(simulatedPhoneFor('user-1'));
    const { service, providerCalls, creditCalls, handoffs } = build();
    await reply(service, seeded);

    expect(providerCalls).toEqual([]);
    expect(creditCalls).toEqual([]);
    expect(handoffs).toEqual([]);

    const out = await prisma.message.findMany({ where: { conversationId: seeded.conversation.id, direction: 'OUTBOUND' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ content: 'Delivery to Accra is GHS 30.', status: 'QUEUED', whatsappMessageId: null, sentAt: null });
    expect(out[0].metadata).toMatchObject({ aiGenerated: true, simulated: true });
    expect(out[0].status).not.toBe('SENT');

    const logs = await prisma.aiInteractionLog.findMany({ where: { conversationId: seeded.conversation.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('SIMULATED');
  });

  it('records an unmetered TEST execution, tagged simulated, with the real token counts, linked to the log', async () => {
    const seeded = await seed(simulatedPhoneFor('user-2'));
    const { service } = build();
    await reply(service, seeded);
    const exec = await prisma.aiExecution.findFirstOrThrow({ where: { conversationId: seeded.conversation.id } });
    const log = await prisma.aiInteractionLog.findFirstOrThrow({ where: { conversationId: seeded.conversation.id } });
    expect(exec).toMatchObject({ taskType: 'TEST', status: 'SUCCESS', provider: 'deepseek', inputTokens: 120, outputTokens: 30, interactionLogId: log.id });
    expect(exec.safetyFlags).toMatchObject({ simulated: true });
  });

  it('the simulated reply is queued for evaluation and the real processor evaluates it (stubbed grader, real database)', async () => {
    const seeded = await seed(simulatedPhoneFor('user-3'));
    const { service, queued, featureFlags } = build();
    await reply(service, seeded);

    expect(queued).toHaveLength(1);
    expect(queued[0].opts.jobId).toBe(`ai-interaction-eval-${queued[0].data.aiExecutionId}`);

    const grade = { dimensions: { accuracy: 5 }, overallScore: 5, failureCategories: [], severity: null, reasoning: 'ok', confidence: 0.9, needsHumanReview: false, falseActionClaim: false, falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false };
    const processor = new AiInteractionEvalProcessor(
      prisma as unknown as PrismaService, new InteractionContextResolver(prisma as unknown as PrismaService), { evaluate: async () => grade } as never, {} as never, featureFlags as never,
    );
    await processor.process({ data: queued[0].data, attemptsMade: 0, opts: { attempts: 3 } } as never);

    const evaluation = await prisma.aiInteractionEvaluation.findUniqueOrThrow({ where: { aiExecutionId: queued[0].data.aiExecutionId } });
    expect(evaluation).toMatchObject({ tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, status: 'EVALUATED', overallScore: 5 });
  });

  it('an escalation in a simulated conversation requests no real handoff and changes no assignment', async () => {
    const seeded = await seed(simulatedPhoneFor('user-4'));
    const { service, handoffs, providerCalls } = build({ reply: { response: "Sure, I'll get someone to help.", confidence: 20, shouldEscalate: true } });
    await reply(service, seeded);
    expect(handoffs).toEqual([]);
    expect(providerCalls).toEqual([]);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: seeded.conversation.id } });
    expect(conversation).toMatchObject({ status: 'OPEN', assignedToId: null });
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: seeded.conversation.id, direction: 'OUTBOUND' } });
    expect(out.metadata).toMatchObject({ simulated: true });
  });

  it('suggestion mode stays a SUGGESTED draft and sends nothing', async () => {
    const seeded = await seed(simulatedPhoneFor('user-5'));
    const { service, providerCalls, creditCalls } = build();
    await reply(service, seeded, 'suggest');
    expect(providerCalls).toEqual([]);
    expect(creditCalls).toEqual([]);
    const logs = await prisma.aiInteractionLog.findMany({ where: { conversationId: seeded.conversation.id } });
    expect(logs.map((l) => l.status)).toEqual(['SUGGESTED']);
    expect(await prisma.message.count({ where: { conversationId: seeded.conversation.id, direction: 'OUTBOUND' } })).toBe(0);
  });

  it("tenant isolation: another tenant's simulated activity is invisible to this tenant's records", async () => {
    const a = await seed(simulatedPhoneFor('user-6'));
    const b = await seed(simulatedPhoneFor('user-6')); // the same synthetic number in two tenants: still two separate contacts
    const { service } = build();
    await reply(service, a);
    expect(await prisma.aiExecution.count({ where: { tenantId: b.tenant.id } })).toBe(0);
    expect(await prisma.message.count({ where: { tenantId: b.tenant.id, direction: 'OUTBOUND' } })).toBe(0);
    expect(await prisma.aiExecution.count({ where: { tenantId: a.tenant.id } })).toBe(1);
  });

  it('CONTRAST: a real customer is delivered, stored as SENT, logged AUTO_SENT, metered as RESPONDER', async () => {
    const seeded = await seed('+233555000111');
    const { service, providerCalls, creditCalls } = build();
    await reply(service, seeded);

    expect(providerCalls).toEqual(['whatsapp.sendTextMessage']);
    expect(creditCalls).toContain('reserveFixedCredits');
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: seeded.conversation.id, direction: 'OUTBOUND' } });
    expect(out).toMatchObject({ status: 'SENT', whatsappMessageId: 'wamid.should-never-exist' });
    expect((out.metadata as { simulated?: boolean } | null)?.simulated).toBeUndefined();
    expect((await prisma.aiInteractionLog.findFirstOrThrow({ where: { conversationId: seeded.conversation.id } })).status).toBe('AUTO_SENT');
    const exec = await prisma.aiExecution.findFirstOrThrow({ where: { conversationId: seeded.conversation.id } });
    expect(exec.taskType).toBe('RESPONDER');
    expect(exec.safetyFlags).toEqual({});
  });

  describe('usage accounting (the admin usage report, read from the stored executions)', () => {
    const usageService = () => new AiTestChatService(prisma as unknown as PrismaService, {} as never, {} as never, new SimulationLimitsService({ get: () => undefined } as never, new MemorySimulationStore()));

    it("reports today's SIMULATED runs for this tenant only, with the provider's own token counts and a catalog-rate cost estimate", async () => {
      const a = await seed(simulatedPhoneFor('user-7'));
      const b = await seed(simulatedPhoneFor('user-7'));
      const { service } = build();
      await reply(service, a);
      await reply(service, a);

      const u = await usageService().getUsage(a.tenant.id, 'user-7');
      expect(u.providerUsageToday).toMatchObject({ calls: 2, succeeded: 2, inputTokens: 240, outputTokens: 60, callsWithoutTokenCounts: 0, costEstimateComplete: true });
      expect(u.providerUsageToday.estimatedCostUsd).toBeGreaterThan(0);
      expect(u.providerUsageToday.costBasis).toMatch(/not verified/i);

      const other = await usageService().getUsage(b.tenant.id, 'user-7');
      expect(other.providerUsageToday).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0 });
    });

    it('does not count a real customer run, or a simulated run from a previous day', async () => {
      const seeded = await seed(simulatedPhoneFor('user-8'));
      const { service } = build();
      await reply(service, seeded);
      // a real RESPONDER execution in the same tenant, and an old simulated one
      await prisma.aiExecution.create({ data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, taskType: 'RESPONDER', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'SUCCESS', inputTokens: 999, outputTokens: 999 } });
      await prisma.aiExecution.create({ data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, taskType: 'TEST', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'SUCCESS', inputTokens: 888, outputTokens: 888, safetyFlags: { simulated: true }, createdAt: new Date(Date.now() - 36 * 3_600_000) } });
      const u = await usageService().getUsage(seeded.tenant.id, 'user-8');
      expect(u.providerUsageToday).toMatchObject({ calls: 1, inputTokens: 120, outputTokens: 30 });
    });

    it('a failed call is counted but has no invented tokens, and the cost is marked incomplete', async () => {
      const seeded = await seed(simulatedPhoneFor('user-9'));
      await prisma.aiExecution.create({ data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, taskType: 'TEST', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'PROVIDER_ERROR', errorCode: 'http_401', safetyFlags: { simulated: true } } });
      const u = await usageService().getUsage(seeded.tenant.id, 'user-9');
      expect(u.providerUsageToday).toMatchObject({ calls: 1, succeeded: 0, inputTokens: null, outputTokens: null, callsWithoutTokenCounts: 1, costEstimateComplete: false, estimatedCostUsd: null });
    });

    it('uses a cost the recorder stored (a Decimal column) in preference to recomputing it', async () => {
      const seeded = await seed(simulatedPhoneFor('user-10'));
      await prisma.aiExecution.create({ data: { tenantId: seeded.tenant.id, conversationId: seeded.conversation.id, taskType: 'TEST', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'SUCCESS', inputTokens: 10, outputTokens: 10, estCostUsd: 0.123456, safetyFlags: { simulated: true } } });
      const u = await usageService().getUsage(seeded.tenant.id, 'user-10');
      expect(u.providerUsageToday.estimatedCostUsd).toBeCloseTo(0.123456, 6);
    });
  });
});
