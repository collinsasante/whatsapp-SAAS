import { AiExecutionStatus, AiExecutionSafetyFlags, AiTaskType } from '@whatsapp-platform/shared-types';

/** Identical shape to the legacy AiSuggestionResult -- drops into existing call sites unchanged. */
export interface VerzAiResult {
  response: string;
  confidence: number | null;
  blocked: boolean;
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
}

export interface PipelineStage {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<void>;
}

export function newTrace(): PipelineTrace {
  return { status: 'EMPTY', safetyFlags: {}, stageTimings: {} };
}
