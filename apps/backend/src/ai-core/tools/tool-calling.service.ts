import { Injectable, Logger } from '@nestjs/common';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { AiProviderError, ChatMessage } from '../providers/ai-provider.interface';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { DEFAULT_MODEL_KEY, estimateCostUsd } from '../models/model-catalog';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { ToolRegistryService } from './tool-registry.service';
import { isToolResultEnvelope, ToolExecutionContext, ToolSideEffect } from './tool-registry.types';
import { sanitizeToolTrace } from './tool-trace-sanitizer.util';
import { AiMeteredProviderService } from '../completion/ai-metered-provider.service';
import { checkCustomerText, ReplyProblem } from '../completion/model-output.util';

const DEFAULT_MAX_ITERATIONS = 4;

/**
 * Why a run's final (tool-free) answer cannot be sent, or undefined when it can. Only `finish_reason=length` is treated as
 * truncation: it means the provider stopped at the token limit. It is checked first because a reply that spent its whole
 * budget before writing anything is better diagnosed as cut off than as blank.
 */
function finalAnswerProblem(content: string, finishReason: string): ReplyProblem | undefined {
  if (finishReason === 'length') return 'truncated';
  const check = checkCustomerText(content);
  return check.safe ? undefined : check.reason;
}

export interface ToolCallingRequest {
  tenantId: string;
  taskType: AiTaskType;
  /** A simulated (Test Chat) run: recorded with safetyFlags.simulated so evaluation can find it even though it is not a RESPONDER task. */
  simulated?: boolean;
  conversationId?: string;
  agentId?: string;
  systemPrompt: string;
  /** Prior turns only -- user/assistant, no tool-call bookkeeping. The system prompt and
   * the current user message are added internally, matching AiCompletionService's shape. */
  historyMessages: ChatMessage[];
  userMessage: string;
  /** Names of registered tools to offer this run -- the capability decision (which
   * tenant/agent gets which tools) is the caller's, not this service's. */
  toolNames: string[];
  toolContext: ToolExecutionContext;
  modelKey?: string;
  maxTokens?: number;
  maxIterations?: number;
}

export interface ToolCallTrace {
  name: string;
  args: unknown;
  result: unknown;
  /** Second hardening pass, Section 2: wall-clock time for this one tool execution
   * (this.tools.execute call below) -- not the whole turn's latency. Optional so
   * existing test fixtures constructing a ToolCallTrace by hand don't all need
   * updating; always populated on the real path. */
  durationMs?: number;
}

export interface ToolCallingResult {
  content: string;
  toolTrace: ToolCallTrace[];
  /** True only on a provider-level failure (network/auth/etc) -- content is '' in that case. */
  failed: boolean;
  /** True if the loop ran out of iterations without a final answer -- distinct from failed:
   * the provider worked, the model just kept calling tools past the bound. Caller decides
   * what to tell the customer in this case. */
  hitMaxIterations: boolean;
  /** Verz-AI unification, Phase G: side effects (e.g. a media send) any tool this run
   * called chose to trigger, collected across every iteration -- the caller is
   * responsible for actually delivering them (see MessagesService.deliverMedia). */
  sideEffects: ToolSideEffect[];
  /** The AiExecution this run recorded (undefined if recording failed), so the caller can link it to its interaction log. */
  executionId?: string;
  /**
   * Set when the model's final answer must not reach the customer: cut off at the token limit, blank, machine output and so on.
   * `content` still holds exactly what the provider returned, for diagnosis; callers must not send it. The execution this run
   * recorded already carries the matching failure status, so the caller does not record it again.
   */
  outputProblem?: ReplyProblem;
}

/**
 * Verz-AI unification, Phase A: the shared tool-calling engine both CommerceAiService
 * (refactored to use this instead of its own raw axios loop) and the general pipeline's
 * GenerationStage (when a run has tools available) call into. One provider abstraction,
 * one tracing sink, one model-catalog cost estimate for every tool-calling AI call on the
 * platform -- mirrors AiCompletionService's shape (never throws, always traces) but adds
 * the bounded multi-turn tool round-trip AiCompletionService doesn't support.
 */
@Injectable()
export class ToolCallingService {
  private readonly logger = new Logger(ToolCallingService.name);

  constructor(
    private registry: ProviderRegistryService,
    private tools: ToolRegistryService,
    private executions: AiExecutionsService,
    private meteredProvider: AiMeteredProviderService,
  ) {}

  async complete(req: ToolCallingRequest): Promise<ToolCallingResult> {
    const modelKey = req.modelKey ?? DEFAULT_MODEL_KEY;
    const maxIterations = req.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const provider = this.registry.forModel(modelKey);
    const toolDefs = this.tools.getDefs(req.toolNames);
    const toolTrace: ToolCallTrace[] = [];
    const sideEffects: ToolSideEffect[] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: req.systemPrompt },
      ...req.historyMessages,
      { role: 'user', content: req.userMessage },
    ];

    const startedAt = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastProvider = 'deepseek';
    const reservationIds: string[] = [];

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const meteredCompletion = await this.meteredProvider.complete(provider, req.tenantId, req.taskType, {
          modelKey,
          messages,
          maxTokens: req.maxTokens,
          ...(toolDefs.length && { tools: toolDefs }),
        });
        const completion = meteredCompletion.result;
        if (meteredCompletion.reservationId) reservationIds.push(meteredCompletion.reservationId);
        totalInputTokens += completion.usage.inputTokens;
        totalOutputTokens += completion.usage.outputTokens;
        lastProvider = completion.provider;

        if (!completion.toolCalls.length) {
          // The final answer is judged before the execution is written, so the stored status is the real outcome. Tokens are
          // kept either way: the provider call happened and was settled by its own reservation.
          const outputProblem = finalAnswerProblem(completion.content, completion.finishReason);
          if (outputProblem) this.logger.warn(`Tool-calling final answer rejected (${outputProblem}, finish_reason=${completion.finishReason}) for conversation ${req.conversationId ?? 'unknown'}`);
          const executionId = await this.trace(req, {
            status: outputProblem ? 'PROVIDER_ERROR' : 'SUCCESS', provider: lastProvider, modelKey,
            latencyMs: Date.now() - startedAt, inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            estCostUsd: estimateCostUsd(modelKey, totalInputTokens, totalOutputTokens),
            ...(outputProblem && { errorCode: 'parse_error', errorMessage: `Model output rejected: ${outputProblem}` }),
          }, toolTrace, reservationIds);
          return { content: completion.content, toolTrace, failed: false, hitMaxIterations: false, sideEffects, executionId, ...(outputProblem && { outputProblem }) };
        }

        messages.push({ role: 'assistant', content: completion.content ?? '', toolCalls: completion.toolCalls });
        for (const call of completion.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments || '{}'); } catch { /* tool handler validates required fields */ }
          const toolStartedAt = Date.now();
          const rawResult = await this.tools.execute(call.name, req.toolContext, args);
          // A tool may return a { forModel, sideEffect? } envelope instead of a bare
          // result -- only forModel goes back into the model's own context; the side
          // effect (e.g. "send this image") is pulled out for the caller to deliver.
          const forModel = isToolResultEnvelope(rawResult) ? rawResult.forModel : rawResult;
          if (isToolResultEnvelope(rawResult) && rawResult.sideEffect) sideEffects.push(rawResult.sideEffect);
          toolTrace.push({ name: call.name, args, result: forModel, durationMs: Date.now() - toolStartedAt });
          messages.push({ role: 'tool', content: JSON.stringify(forModel), toolCallId: call.id });
        }
      }

      this.logger.warn(`Tool-calling hit max iterations (${maxIterations}) for conversation ${req.conversationId ?? 'unknown'}`);
      const executionId = await this.trace(req, {
        status: 'SUCCESS', provider: lastProvider, modelKey,
        latencyMs: Date.now() - startedAt, inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        estCostUsd: estimateCostUsd(modelKey, totalInputTokens, totalOutputTokens),
      }, toolTrace, reservationIds);
      return { content: '', toolTrace, failed: false, hitMaxIterations: true, sideEffects, executionId };
    } catch (err) {
      const providerErr = err instanceof AiProviderError ? err : new AiProviderError('network', String(err), false, err);
      this.logger.warn(`Tool-calling call failed (${req.taskType}, ${providerErr.code}): ${providerErr.message}`);
      const executionId = await this.trace(req, {
        status: 'PROVIDER_ERROR', provider: 'deepseek', modelKey,
        latencyMs: Date.now() - startedAt, errorCode: providerErr.code, errorMessage: providerErr.message,
      }, toolTrace, reservationIds);
      return { content: '', toolTrace, failed: true, hitMaxIterations: false, sideEffects, executionId };
    }
  }

  private async trace(
    req: ToolCallingRequest,
    trace: {
      status: 'SUCCESS' | 'PROVIDER_ERROR'; provider: string; modelKey: string; latencyMs: number;
      inputTokens?: number; outputTokens?: number; estCostUsd?: number; errorCode?: string; errorMessage?: string;
    },
    // Second hardening pass, Section 2: whatever tool calls actually ran before this
    // trace point (empty array on a call that never invoked a tool) -- sanitized here,
    // once, rather than at every call site.
    toolTrace: ToolCallTrace[],
    reservationIds: string[],
  ): Promise<string | undefined> {
    const execution = await this.executions
      .record(
        { tenantId: req.tenantId, agentId: req.agentId, conversationId: req.conversationId, taskType: req.taskType },
        {
          ...trace,
          safetyFlags: req.simulated ? { simulated: true } : {},
          stageTimings: {},
          toolTrace: toolTrace.length > 0 ? sanitizeToolTrace(toolTrace) : undefined,
          ...(reservationIds.length > 0 && { reservationIds }),
        },
      )
      .catch((err) => {
        this.logger.warn(`Failed to record AiExecution trace: ${String(err)}`);
        return null;
      });
    return execution?.id;
  }
}
