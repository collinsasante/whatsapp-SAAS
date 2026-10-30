import axios from 'axios';
import { AiResponderService } from '../ai/ai-responder.service';
import { CommerceAiService } from '../commerce/ai/commerce-ai.service';
import { ContextAssemblyStage } from '../ai-core/pipeline/stages/context-assembly.stage';
import { newTrace, type PipelineContext } from '../ai-core/pipeline/pipeline.types';
import { DigitalSelfContextService } from './digital-self-context.service';
import { extractFeatures } from './message-features.util';
import { emptyProfile, mergeFeatures } from './profile.util';

jest.mock('axios');

const learn = (texts: string[], times: number) =>
  mergeFeatures(emptyProfile(), Array.from({ length: times }, () => texts).flat().map((t) => extractFeatures(t)!));
const AMA_PROFILE = learn(["Hello! I'd be happy to help 😊 What size are you looking for? Let me know, thank you!"], 20);
const KOFI_PROFILE = learn(['Kindly send the size. Price is as listed. Delivery is tomorrow.'], 20);

type Self = { id: string; tenantId: string; userId: string; enabled: boolean; profile: unknown; user: { isActive: boolean; isAiAgent: boolean; role: string; workspaceMemberships: Array<{ status: string }> } };
const self = (id: string, userId: string, profile: unknown, over: Partial<Self> = {}, userOver: Partial<Self['user']> = {}): Self => ({
  id, tenantId: 't1', userId, enabled: true, profile, user: { isActive: true, isAiAgent: false, role: 'AGENT', workspaceMemberships: [{ status: 'ACTIVE' }], ...userOver }, ...over,
});

function world(opts: { conv?: Record<string, unknown> | null; selves?: Self[]; flag?: boolean; failing?: boolean } = {}) {
  const selves = opts.selves ?? [self('dsAma', 'ama', AMA_PROFILE), self('dsKofi', 'kofi', KOFI_PROFILE)];
  const conv = opts.conv === undefined ? { digitalSelfId: 'dsAma', assignedToId: null } : opts.conv;
  const prisma = {
    conversation: { findFirst: jest.fn(async ({ where }) => { if (opts.failing) throw new Error('db down'); return conv && where.tenantId === 't1' ? { ...conv } : null; }) },
    digitalSelf: { findFirst: jest.fn(async ({ where }) => selves.find((s) => s.tenantId === where.tenantId && (where.id ? s.id === where.id : s.userId === where.userId)) ?? null) },
  };
  const flags = { isEnabledCached: jest.fn().mockResolvedValue(opts.flag ?? true) };
  return { prisma, conv, ctx: new DigitalSelfContextService(prisma as never, flags as never), flags };
}

describe('DigitalSelfContextService.getStyleBlock', () => {
  it('returns the assigned agent\'s style, and a different one after the assignment changes', async () => {
    const w = world();
    const ama = await w.ctx.getStyleBlock('t1', 'c1');
    expect(ama).toContain('Energy: enthusiastic');
    w.conv!['digitalSelfId'] = 'dsKofi';
    const kofi = await w.ctx.getStyleBlock('t1', 'c1');
    expect(kofi).toContain('Register: formal');
    expect(kofi).not.toContain('enthusiastic');
    expect(ama).not.toEqual(kofi);
  });

  it('is scoped by tenant on every lookup', async () => {
    const w = world();
    await w.ctx.getStyleBlock('t1', 'c1');
    expect(w.prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', tenantId: 't1' });
    expect(w.prisma.digitalSelf.findFirst.mock.calls[0][0].where).toEqual({ id: 'dsAma', tenantId: 't1' });
    expect(await w.ctx.getStyleBlock('t2', 'c1')).toBe('');
  });

  it('defaults to the human owner\'s Digital Self, and to nothing for an AI-owned or unowned conversation', async () => {
    expect(await world({ conv: { digitalSelfId: null, assignedToId: 'ama' } }).ctx.getStyleBlock('t1', 'c1')).toContain('enthusiastic');
    expect(await world({ conv: { digitalSelfId: null, assignedToId: 'verz-ai' } }).ctx.getStyleBlock('t1', 'c1')).toBe('');
    expect(await world({ conv: { digitalSelfId: null, assignedToId: null } }).ctx.getStyleBlock('t1', 'c1')).toBe('');
  });

  it.each([
    ['the feature flag is off', { flag: false }],
    ['the Digital Self is deactivated', { selves: [self('dsAma', 'ama', AMA_PROFILE, { enabled: false })] }],
    ['the agent is deactivated', { selves: [self('dsAma', 'ama', AMA_PROFILE, {}, { isActive: false })] }],
    ['the agent is suspended in the workspace', { selves: [self('dsAma', 'ama', AMA_PROFILE, {}, { workspaceMemberships: [{ status: 'SUSPENDED' }] })] }],
    ['the "agent" is the AI user', { selves: [self('dsAma', 'ama', AMA_PROFILE, {}, { isAiAgent: true })] }],
    ['too little has been learned', { selves: [self('dsAma', 'ama', learn(['Hello!'], 3))] }],
    ['the conversation does not exist', { conv: null }],
    ['the lookup fails', { failing: true }],
  ])('returns nothing (existing AI behaviour) when %s', async (_label, opts) => {
    expect(await world(opts).ctx.getStyleBlock('t1', 'c1')).toBe('');
  });

  it('never queries when there is no conversation id', async () => {
    const w = world();
    expect(await w.ctx.getStyleBlock('t1', undefined)).toBe('');
    expect(w.prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- the three response paths
const prisma3 = () => ({
  tenantSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme Prints', aiPersonality: null }) },
  conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', contactId: 'ct1' }) },
  message: { findMany: jest.fn().mockResolvedValue([]) },
});
const noGuidance = { getGuidanceBlock: async () => '' };

describe('commerce AI', () => {
  async function promptWith(ctx?: DigitalSelfContextService) {
    const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'ok', toolTrace: [], failed: false, hitMaxIterations: false, sideEffects: [] }) };
    const service = new CommerceAiService(prisma3() as never, { getRelevant: jest.fn().mockResolvedValue([]) } as never, { getState: jest.fn().mockResolvedValue(null), mergeState: jest.fn() } as never, toolCalling as never, noGuidance as never, ctx);
    process.env.DEEPSEEK_API_KEY = 'test';
    await service.handleMessage('t1', 'c1', 'ct1', '+233555000111', 'do you have labels?', 'Jane');
    return toolCalling.complete.mock.calls[0][0].systemPrompt as string;
  }

  it('two agents give different styles over byte-identical business rules and tools', async () => {
    const w = world();
    const ama = await promptWith(w.ctx);
    const amaBlock = await w.ctx.getStyleBlock('t1', 'c1');
    w.conv!['digitalSelfId'] = 'dsKofi';
    const kofi = await promptWith(w.ctx);
    const kofiBlock = await w.ctx.getStyleBlock('t1', 'c1');
    expect(ama).toContain('Energy: enthusiastic');
    expect(kofi).toContain('Register: formal');
    expect(ama).not.toEqual(kofi);
    // Remove each agent's own block and the two prompts are identical: facts, rules and tool instructions do not depend on whose style it is.
    expect(ama.replace(amaBlock, '')).toBe(kofi.replace(kofiBlock, ''));
  });

  it('puts the style before the safety block so safety stays last, and the style cannot claim to change facts', async () => {
    const prompt = await promptWith(world().ctx);
    expect(prompt.indexOf('COMMUNICATION STYLE')).toBeGreaterThan(-1);
    expect(prompt.indexOf('COMMUNICATION STYLE')).toBeLessThan(prompt.indexOf('ABSOLUTE SAFETY GUARDRAILS'));
    expect(prompt).toMatch(/never changes facts, prices, stock, policies or what you may promise/);
  });

  it('is byte-identical to today\'s prompt when no Digital Self applies, or the lookup fails, or the service is absent', async () => {
    const baseline = await promptWith(undefined);
    expect(await promptWith(world({ conv: { digitalSelfId: null, assignedToId: null } }).ctx)).toBe(baseline);
    expect(await promptWith(world({ failing: true }).ctx)).toBe(baseline);
    expect(await promptWith(world({ flag: false }).ctx)).toBe(baseline);
  });
});

describe('legacy responder', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'unit-test-placeholder';
    (axios.post as jest.Mock).mockReset().mockResolvedValue({ data: { choices: [{ message: { content: '{"response":"ok","confidence":90}' } }] } });
  });
  async function promptWith(ctx?: DigitalSelfContextService) {
    (axios.post as jest.Mock).mockClear();
    await new AiResponderService(prisma3() as never, { getRelevant: jest.fn().mockResolvedValue([]) } as never, noGuidance as never, ctx).generateSuggestion('t1', 'c1', 'hello');
    return (axios.post as jest.Mock).mock.calls[0][1].messages[0].content as string;
  }

  it('uses the assigned style, before the safety guardrails', async () => {
    const prompt = await promptWith(world().ctx);
    expect(prompt).toContain('Energy: enthusiastic');
    expect(prompt.indexOf('COMMUNICATION STYLE')).toBeLessThan(prompt.indexOf('ABSOLUTE SAFETY GUARDRAILS'));
    expect(prompt).toContain('Use ONLY the knowledge base below');
  });
  it('is byte-identical to today\'s prompt when nothing applies or the lookup fails', async () => {
    const baseline = await promptWith(undefined);
    expect(await promptWith(world({ conv: { digitalSelfId: null, assignedToId: null } }).ctx)).toBe(baseline);
    expect(await promptWith(world({ failing: true }).ctx)).toBe(baseline);
  });
});

describe('v2 pipeline context assembly', () => {
  const pctx = (): PipelineContext => ({
    input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'hello', taskType: 'RESPONDER' },
    businessName: '', personality: '', systemInstructions: '', modelKey: 'm', maxResponseTokens: 400, customerMessage: 'hello', historyMessages: [], knowledgeContext: '', shortCircuit: false, trace: newTrace(),
  });
  const stage = (ctx?: DigitalSelfContextService) =>
    new ContextAssemblyStage(
      { tenantSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme' }) }, message: { findMany: jest.fn().mockResolvedValue([]) }, conversation: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
      { getState: jest.fn().mockResolvedValue(null) } as never,
      { getContext: jest.fn().mockResolvedValue('\n\nKNOWLEDGE BASE:\n## Hours\n9 to 5') },
      ctx,
    );

  it('appends the style after the knowledge base context', async () => {
    const c = pctx();
    await stage(world().ctx).execute(c);
    expect(c.knowledgeContext).toContain('KNOWLEDGE BASE');
    expect(c.knowledgeContext).toContain('Energy: enthusiastic');
    expect(c.knowledgeContext.indexOf('KNOWLEDGE BASE')).toBeLessThan(c.knowledgeContext.indexOf('COMMUNICATION STYLE'));
  });
  it('leaves the knowledge context untouched when nothing applies or the lookup fails', async () => {
    for (const ctx of [undefined, world({ failing: true }).ctx, world({ flag: false }).ctx]) {
      const c = pctx();
      await stage(ctx).execute(c);
      expect(c.knowledgeContext).toBe('\n\nKNOWLEDGE BASE:\n## Hours\n9 to 5');
    }
  });
});
