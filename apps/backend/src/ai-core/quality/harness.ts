/**
 * CI-safe evaluation harness for conversation quality. It runs the REAL production classes for all three generators --
 * the legacy AiResponderService, the v2 pipeline (guard, context assembly, prompt build, generation, policy and escalation
 * stages), and CommerceAiService -- with the real knowledge-base ranking, history selection, injection guard, output
 * parsing and human-request detection. Only two things are replaced:
 *   - the database: a small in-memory stand-in that applies the same tenant / conversation / contact scoping and
 *     (createdAt, id) ordering as the real queries;
 *   - the model provider: it returns the scripted output of the scenario and records exactly what it was sent.
 * Nothing here calls a model, so it proves what the model is GIVEN and what the customer RECEIVES from a given model
 * output. It does not, and cannot, show how natural a real model's wording is: that needs live replies (Phase 2).
 */
import axios from 'axios';
import { AiResponderService } from '../../ai/ai-responder.service';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';
import { CommerceAiService } from '../../commerce/ai/commerce-ai.service';
import { VerzAiPipelineService } from '../pipeline/verz-ai-pipeline.service';
import { GuardStage } from '../pipeline/stages/guard.stage';
import { ContextAssemblyStage } from '../pipeline/stages/context-assembly.stage';
import { PromptBuildStage } from '../pipeline/stages/prompt-build.stage';
import { GenerationStage } from '../pipeline/stages/generation.stage';
import { PolicyStage } from '../pipeline/stages/policy.stage';
import { EscalationStage } from '../pipeline/stages/escalation.stage';
import { KbRelevantContextSource } from '../pipeline/knowledge-context.source';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { PromptsService } from '../prompts/prompts.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { MockProvider } from '../providers/mock.provider';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';
import { RESPONDER_SYSTEM_BODY, RESPONDER_SYSTEM_VERSION } from '../prompts/seed/responder-system.v1';

export type Generator = 'legacy' | 'v2' | 'commerce';
export const GENERATORS: Generator[] = ['legacy', 'v2', 'commerce'];

export interface Article { title: string; content: string }

/** A message row in the in-memory database. `at` is seconds from an arbitrary start; equal values model the same millisecond. */
export interface StoredMessage {
  id: string;
  dir: 'IN' | 'OUT';
  text: string;
  at: number;
  tenantId?: string;
  conversationId?: string;
  contactId?: string;
}

export interface Scenario {
  id: string;
  category: string;
  title: string;
  generators: Generator[];
  kb?: Article[];
  stored: StoredMessage[];
  /** Id of the stored inbound message being answered. */
  current: string;
  /** What the model "says" (plain text). Wrapped as {"response", "confidence"} for legacy and v2. */
  reply?: string;
  /** Overrides the raw model output for legacy and v2 (malformed, truncated, error bodies...). */
  rawModel?: string;
  /** Overrides the model's text for Commerce, which answers in plain text. */
  commerceText?: string;
  expect: {
    /** History the model is shown before the final user turn, as "C: ..." / "AI: ...". */
    turns?: string[];
    /** Per-generator override of `turns` (the legacy responder reads the contact's other conversations too). */
    turnsBy?: Partial<Record<Generator, string[]>>;
    kbTitles?: string[];
    /** The first N retrieved titles, in any order (competing matches). */
    kbTopAnyOf?: string[];
    kbNone?: boolean;
    blocked?: boolean;
    modelCalled?: boolean;
    /** What the customer receives: exact text, regex, or '' for "nothing is sent" (the existing recovery path takes over). */
    response?: string | RegExp;
    responseBy?: Partial<Record<Generator, string | RegExp>>;
    escalate?: boolean;
    escalateBy?: Partial<Record<Generator, boolean>>;
  };
}

export interface Observed {
  turns: string[];
  finalUser: string | null;
  kbTitles: string[];
  response: string;
  escalate: boolean;
  blocked: boolean;
  modelCalled: boolean;
}

export const TENANT = 't1';
export const CONVERSATION = 'c1';
export const CONTACT = 'contact-1';

function dbRows(stored: StoredMessage[]): Required<StoredMessage>[] {
  return stored.map((m) => ({ tenantId: TENANT, conversationId: CONVERSATION, contactId: CONTACT, ...m }));
}

/** Applies the same where-clause scoping, ordering and `take` as the real message queries. */
function messageFindMany(stored: StoredMessage[]) {
  const rows = dbRows(stored);
  return jest.fn(async (args: { where: Record<string, unknown>; take: number }) => {
    const w = args.where as { tenantId: string; conversationId?: string; conversation?: { tenantId: string; contactId: string } };
    return rows
      .filter((m) => m.tenantId === w.tenantId
        && (w.conversationId === undefined || m.conversationId === w.conversationId)
        && (w.conversation === undefined || (m.tenantId === w.conversation.tenantId && m.contactId === w.conversation.contactId)))
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
      .slice(0, args.take)
      .map((m) => ({ id: m.id, direction: m.dir === 'IN' ? 'INBOUND' : 'OUTBOUND', content: m.text, createdAt: new Date(m.at * 1000) }));
  });
}

function prismaFor(s: Scenario) {
  return {
    tenantSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Kente Shop', aiPersonality: null }) },
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: CONVERSATION, contactId: CONTACT, adSourceId: null, adHeadline: null, adImageUrl: null }) },
    message: { findMany: messageFindMany(s.stored) },
    knowledgeBaseArticle: { findMany: jest.fn().mockResolvedValue(s.kb ?? []) },
    aiAgent: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-1', tenantId: TENANT, personality: null, systemInstructions: '', modelKey: DEFAULT_MODEL_KEY, maxResponseTokens: 400 }) },
    aiPromptTemplate: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tmpl-1',
        versions: [{ id: 'ver-1', templateId: 'tmpl-1', version: RESPONDER_SYSTEM_VERSION, body: RESPONDER_SYSTEM_BODY, variables: [] }],
      }),
      create: jest.fn(),
    },
    aiExecution: { create: jest.fn((args: { data: object }) => Promise.resolve({ id: 'exec-1', ...args.data })) },
  };
}

const modelRaw = (s: Scenario) => s.rawModel ?? JSON.stringify({ response: s.reply ?? 'Sure, happy to help.', confidence: 90 });

function label(role: string, content: string): string {
  return `${role === 'user' ? 'C' : 'AI'}: ${content}`;
}

function titlesIn(systemPrompt: string): string[] {
  const at = systemPrompt.indexOf('KNOWLEDGE BASE');
  if (at === -1) return [];
  return [...systemPrompt.slice(at).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
}

function currentText(s: Scenario): string {
  const row = s.stored.find((m) => m.id === s.current);
  if (!row) throw new Error(`scenario ${s.id}: current message ${s.current} is not in its stored messages`);
  return row.text;
}

function knowledgeBase(prisma: ReturnType<typeof prismaFor>): KnowledgeBaseService {
  return new KnowledgeBaseService(prisma as never, {} as never);
}

interface ChatTurn { role: string; content: string }

function observeChat(messages: ChatTurn[]): Pick<Observed, 'turns' | 'finalUser' | 'kbTitles'> {
  const [system, ...rest] = messages;
  const last = rest[rest.length - 1];
  return {
    turns: rest.slice(0, -1).map((m) => label(m.role, m.content)),
    finalUser: last?.content ?? null,
    kbTitles: titlesIn(system.content),
  };
}

const none: Observed = { turns: [], finalUser: null, kbTitles: [], response: '', escalate: false, blocked: false, modelCalled: false };

export async function runLegacy(s: Scenario): Promise<Observed> {
  process.env.DEEPSEEK_API_KEY = 'test';
  const post = axios.post as jest.Mock;
  post.mockReset();
  post.mockResolvedValue({ data: { choices: [{ message: { content: modelRaw(s) } }] } });
  const prisma = prismaFor(s);
  const service = new AiResponderService(prisma as never, knowledgeBase(prisma));
  const result = await service.generateSuggestion(TENANT, CONVERSATION, currentText(s), undefined, undefined, s.current);
  if (post.mock.calls.length === 0) return { ...none, response: result.response, blocked: result.blocked };
  const sent = (post.mock.calls[0][1] as { messages: ChatTurn[] }).messages;
  return { ...observeChat(sent), response: result.response, escalate: false, blocked: result.blocked, modelCalled: true };
}

export async function runV2(s: Scenario): Promise<Observed> {
  const provider = new MockProvider();
  (provider as { key: string }).key = 'deepseek';
  provider.nextResult = {
    content: modelRaw(s), toolCalls: [], finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 20 },
    provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 1,
  };
  const prisma = prismaFor(s);
  const kb = knowledgeBase(prisma);
  const state = { getState: jest.fn().mockResolvedValue(null), mergeState: jest.fn().mockResolvedValue(undefined) };
  const registry = new ProviderRegistryService(provider as never);
  const metered = { complete: async (p: MockProvider, _t: string, _k: string, req: Parameters<MockProvider['complete']>[0]) => ({ result: await p.complete(req), reservationId: 'r1' }) };
  const executions = new AiExecutionsService(
    prisma as never,
    { linkReservationsToExecution: jest.fn().mockResolvedValue(undefined), settleForExecution: jest.fn().mockResolvedValue(undefined) } as never,
    { getCreditsForUsage: jest.fn().mockResolvedValue(0) } as never,
    { maybeEnqueue: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const pipeline = new VerzAiPipelineService(
    prisma as never, executions,
    new GuardStage(prisma as never),
    new ContextAssemblyStage(prisma as never, state as never, new KbRelevantContextSource(kb)),
    new PromptBuildStage(new PromptsService(prisma as never)),
    new GenerationStage(registry, {} as never, state as never, metered as never),
    new PolicyStage(),
    new EscalationStage(),
  );
  const result = await pipeline.run({
    tenantId: TENANT, agentId: 'agent-1', conversationId: CONVERSATION, customerMessage: currentText(s), currentMessageId: s.current, taskType: 'RESPONDER',
  });
  if (provider.calls.length === 0) return { ...none, response: result.response, blocked: result.blocked, escalate: !!result.shouldEscalate };
  return { ...observeChat(provider.calls[0].messages as ChatTurn[]), response: result.response, escalate: !!result.shouldEscalate, blocked: result.blocked, modelCalled: true };
}

export async function runCommerce(s: Scenario): Promise<Observed> {
  process.env.DEEPSEEK_API_KEY = 'test';
  const prisma = prismaFor(s);
  const toolCalling = {
    complete: jest.fn().mockResolvedValue({ content: s.commerceText ?? s.reply ?? 'Sure, happy to help.', toolTrace: [], failed: false, hitMaxIterations: false, sideEffects: [] }),
  };
  const state = { getState: jest.fn().mockResolvedValue(null), mergeState: jest.fn().mockResolvedValue(undefined) };
  const service = new CommerceAiService(prisma as never, knowledgeBase(prisma), state as never, toolCalling as never);
  const result = await service.handleMessage(TENANT, CONVERSATION, CONTACT, '+233555000111', currentText(s), undefined, undefined, { currentMessageId: s.current });
  if (toolCalling.complete.mock.calls.length === 0) return { ...none, response: result.response, blocked: result.blocked, escalate: !!result.shouldEscalate };
  const call = toolCalling.complete.mock.calls[0][0] as { systemPrompt: string; historyMessages: ChatTurn[]; userMessage: string };
  return {
    turns: call.historyMessages.map((m) => label(m.role, m.content)),
    finalUser: call.userMessage,
    kbTitles: titlesIn(call.systemPrompt),
    response: result.response, escalate: !!result.shouldEscalate, blocked: result.blocked, modelCalled: true,
  };
}

export function run(generator: Generator, s: Scenario): Promise<Observed> {
  return generator === 'legacy' ? runLegacy(s) : generator === 'v2' ? runV2(s) : runCommerce(s);
}
