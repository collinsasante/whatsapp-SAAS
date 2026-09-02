// Verz-AI Phase 1 shared types. Kept intentionally small -- Phase 2+ fields
// (tools, knowledge sources, working hours, escalation, handoff, memory) are
// typed as opaque Json on the Prisma model until those phases define real shapes.

export type AiAgentStatus = 'ACTIVE' | 'PAUSED';

export interface AiAgent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  status: AiAgentStatus;
  isDefault: boolean;
  agentUserId: string | null;
  systemInstructions: string | null;
  personality: string | null;
  tone: string | null;
  language: string;
  modelKey: string;
  maxResponseTokens: number;
  confidenceThreshold: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AiPromptVersionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface AiPromptTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiPromptVersion {
  id: string;
  templateId: string;
  version: string;
  status: AiPromptVersionStatus;
  body: string;
  variables: string[];
  changeNote: string | null;
  createdById: string | null;
  activatedAt: Date | null;
  createdAt: Date;
}

/** Mirrors AiInteractionLog's status set for RESPONDER traces; other task types use SUCCESS/PROVIDER_ERROR/EMPTY only. */
export type AiExecutionStatus = 'SUCCESS' | 'BLOCKED' | 'POLICY_REJECTED' | 'PROVIDER_ERROR' | 'EMPTY';

export type AiTaskType = 'RESPONDER' | 'SUMMARIZE' | 'KB_LEARN' | 'TEST';

export interface AiExecutionSafetyFlags {
  injectionDetected?: boolean;
  fallbackCapped?: boolean;
  emptyOutput?: boolean;
  humanEscalation?: boolean;
  escalationReason?: 'explicit_request' | 'low_confidence';
}

export interface AiExecution {
  id: string;
  tenantId: string;
  agentId: string | null;
  conversationId: string | null;
  interactionLogId: string | null;
  promptVersionId: string | null;
  taskType: AiTaskType;
  provider: string;
  modelKey: string;
  status: AiExecutionStatus;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estCostUsd: number | null;
  confidence: number | null;
  safetyFlags: AiExecutionSafetyFlags | null;
  errorCode: string | null;
  errorMessage: string | null;
  stageTimings: Record<string, number> | null;
  createdAt: Date;
}
