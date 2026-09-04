import { AiExecutionStatus, AiExecutionSafetyFlags, AiTaskType } from '@whatsapp-platform/shared-types';
import { ToolExecutionContext, ToolSideEffect } from '../tools/tool-registry.types';
import { BusinessInfoSettings, AdContext } from '../prompts/business-info.util';
import { AiState } from '../tools/state-derivation.util';

/**
 * Same shape as the legacy AiSuggestionResult plus two new fields
 * (`shouldEscalate`, `mediaToSend`) -- drops into existing call sites unchanged
 * since legacy code never reads a field it doesn't know about.
 */
export interface VerzAiResult {
  response: string;
  confidence: number | null;
  blocked: boolean;
  /** Set by EscalationStage; the caller (messages.service.ts) is responsible for
   * actually moving the conversation to the REQUESTED queue -- the pipeline only
   * decides, it never mutates conversation state itself (keeps this module from
   * needing ConversationsService, which would create another circular import). */
  shouldEscalate?: boolean;
  /** Verz-AI unification, Phase G: side effects (e.g. send_product_image) a tool
   * call this turn triggered -- the caller is responsible for actually delivering
   * them (see MessagesService.deliverMedia). Empty/undefined when no tools ran. */
  mediaToSend?: ToolSideEffect[];
}

export interface PipelineInput {
  tenantId: string;
  agentId: string;
  conversationId: string;
  customerMessage: string;
  contactName?: string;
  taskType: AiTaskType;
  /** Verz-AI unification, Phase E: required alongside tool-calling -- every tool
   * handler needs these to act (see ToolExecutionContext). Optional here only
   * because non-tool-calling callers (none exist today, but the type shouldn't
   * force it) don't need them; runVerzAiV2 always supplies them. */
  contactId?: string;
  customerPhone?: string;
  /** Verz-AI unification, Phase E: mirrors CommerceAiService's own readOnlyTools
   * flag -- true in SUGGESTION mode, withholds state-changing tools until a human
   * has reviewed/sent the reply or AUTO_REPLY sends it directly. */
  readOnlyTools?: boolean;
}

export interface PipelineTrace {
  status: AiExecutionStatus;
  promptVersionId?: string;
  provider?: string;
  modelKey?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd?: number;
  confidence?: number | null;
  safetyFlags: AiExecutionSafetyFlags;
  errorCode?: string;
  errorMessage?: string;
  stageTimings: Record<string, number>;
  /** Set by GenerationStage's tools branch: ToolCallingService already wrote
   * its own AiExecution row (with real tokens/cost) for this turn via its
   * internal trace() call. VerzAiPipelineService.run()'s outer finally block
   * must skip its own record() call when this is true, or every tool-calling
   * pipeline run would double-write (and, once credit charging is wired to
   * AiExecutionsService.record(), double-charge) -- the outer trace here has
   * no token/cost data of its own to record anyway. */
  alreadyRecorded?: boolean;
}

/**
 * Mutable working state threaded through every pipeline stage. `result` and
 * `shortCircuit` let an early stage (e.g. GuardStage on an injection hit)
 * finish the pipeline immediately without later stages running at all.
 */
export interface PipelineContext {
  input: PipelineInput;
  businessName: string;
  personality: string;
  systemInstructions: string;
  modelKey: string;
  maxResponseTokens: number;
  customerMessage: string; // mutable: menu-digit expansion rewrites this
  historyMessages: { role: 'user' | 'assistant'; content: string }[];
  knowledgeContext: string;
  /** Verz-AI unification, Phase D: real TenantSettings fields (address/phone/
   * hours) -- previously captured nowhere in this pipeline, only businessName was. */
  businessInfo?: BusinessInfoSettings;
  /** Verz-AI unification, Phase D: real data from WhatsApp's Click-to-WhatsApp-Ads
   * referral payload, when this conversation actually originated from an ad click. */
  adContext?: AdContext;
  /** Verz-AI unification, Phase F: advisory cross-turn state for this conversation. */
  conversationState?: AiState | null;
  promptVersionId?: string;
  renderedSystemPrompt?: string;
  result?: VerzAiResult;
  shortCircuit: boolean;
  trace: PipelineTrace;
  /** Verz-AI unification, Phase A/E: names of registered ai-core tools to offer this
   * run (see ai-core/tools/tool-registry.service.ts). Undefined/empty means no tools --
   * GenerationStage falls back to its original single-shot JSON completion unchanged.
   * Populated by VerzAiPipelineService.run() via tool-capability.util.ts's
   * resolveToolNames() for every run (non-commerce tenants only reach this pipeline
   * at all, see messages.service.ts's generateAiReply). */
  tools?: string[];
  /** Required alongside `tools` when non-empty -- the real IDs a tool handler needs to
   * act (contactId/customerPhone), which PipelineInput doesn't carry today. */
  toolContext?: ToolExecutionContext;
}

export interface PipelineStage {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<void>;
}

export function newTrace(): PipelineTrace {
  return { status: 'EMPTY', safetyFlags: {}, stageTimings: {} };
}
