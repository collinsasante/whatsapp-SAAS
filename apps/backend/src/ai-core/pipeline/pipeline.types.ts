import { AiExecutionStatus, AiExecutionSafetyFlags, AiTaskType } from '@whatsapp-platform/shared-types';
import { ToolExecutionContext } from '../tools/tool-registry.types';

/**
 * Same shape as the legacy AiSuggestionResult plus one new field
 * (`shouldEscalate`) -- drops into existing call sites unchanged since
 * legacy code never reads a field it doesn't know about.
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
}

export interface PipelineInput {
  tenantId: string;
  agentId: string;
  conversationId: string;
  customerMessage: string;
  contactName?: string;
  taskType: AiTaskType;
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
  promptVersionId?: string;
  renderedSystemPrompt?: string;
  result?: VerzAiResult;
  shortCircuit: boolean;
  trace: PipelineTrace;
  /** Verz-AI unification, Phase A: names of registered ai-core tools to offer this run
   * (see ai-core/tools/tool-registry.service.ts). Undefined/empty means no tools --
   * GenerationStage falls back to its original single-shot JSON completion unchanged.
   * Nothing populates this yet; wiring per-tenant/per-agent capability into it is a
   * Phase C concern (see the Verz-AI unification plan). */
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
