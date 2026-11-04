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
import { checkCustomerText, parseStructuredReply, ReplyProblem } from '../completion/model-output.util';
import { describeErrorForLog } from '../../common/privacy/prompt-redaction.util';

const DEFAULT_MAX_ITERATIONS = 4;

/** What a run's final (tool-free) answer comes to: the text to send and the model's own confidence, or why it cannot be sent. */
type FinalAnswer = { problem: ReplyProblem } | { problem?: undefined; response: string; confidence: number | null };

/**
 * Judges a run's final (tool-free) answer. Only `finish_reason=length` is treated as truncation: it means the provider stopped at
 * the token limit. It is checked first because a reply that spent its whole budget before writing anything is better diagnosed as
 * cut off than as blank.
 *
 * `plain` (the default, and what Commerce uses) expects clean prose, so anything JSON-shaped is machine output and is refused.
 * `structured` is for callers whose prompt asks for {"response","confidence"} (the Verz-AI v2 responder): the reply is read the same
 * way the single-shot path reads it, so a well-formed object is unwrapped to its `response` and prose is still accepted when the
 * model ignores the format. Broken or ambiguous JSON is refused either way.
 */
function judgeFinalAnswer(content: string, finishReason: string, format: ReplyFormat): FinalAnswer {
  if (finishReason === 'length') return { problem: 'truncated' };
  if (format === 'structured') {
    const parsed = parseStructuredReply(content);
    return parsed.ok ? { response: parsed.response, confidence: parsed.confidence } : { problem: parsed.reason };
  }
  const check = checkCustomerText(content);
  return check.safe ? { response: content, confidence: null } : { problem: check.reason };
}

export type ReplyFormat = 'plain' | 'structured';

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
  /** How the final answer is read: see judgeFinalAnswer. Defaults to 'plain', so callers that do not ask for JSON are unchanged. */
  replyFormat?: ReplyFormat;
  /** Extra JSON recorded with this run's execution (in safetyFlags), e.g. which knowledge articles informed the prompt. Cannot override `simulated`. */
  traceMetadata?: Record<string, unknown>;
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
  /** Set on a `structured` run only: the model's own 0-100 confidence, or null when it wrote prose or omitted it. Absent on a `plain` run. */
  confidence?: number | null;
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
    // Execution-time authorization: only tools that were actually OFFERED to the model in this run may execute. The registry holds every tool on the
    // platform; without this check a model that hallucinates, or is steered by a prompt injection, could call a tool that was not offered (for example an
    // order or payment tool during a read-only suggestion run).
    const offeredTools = new Set(toolDefs.map((d) => d.name));
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
          const format = req.replyFormat ?? 'plain';
          const answer = judgeFinalAnswer(completion.content, completion.finishReason, format);
          const outputProblem = answer.problem;
          if (outputProblem) this.logger.warn(`Tool-calling final answer rejected (${outputProblem}, finish_reason=${completion.finishReason}) for conversation ${req.conversationId ?? 'unknown'}`);
          const executionId = await this.trace(req, {
            status: outputProblem ? 'PROVIDER_ERROR' : 'SUCCESS', provider: lastProvider, modelKey,
            latencyMs: Date.now() - startedAt, inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            estCostUsd: estimateCostUsd(modelKey, totalInputTokens, totalOutputTokens),
            ...(outputProblem && { errorCode: 'parse_error', errorMessage: `Model output rejected: ${outputProblem}` }),
          }, toolTrace, reservationIds);
          // A rejected answer is handed back exactly as the provider wrote it (for diagnosis); an accepted one is the text to send.
          return answer.problem
            ? { content: completion.content, toolTrace, failed: false, hitMaxIterations: false, sideEffects, executionId, outputProblem: answer.problem }
            : { content: answer.response, ...(format === 'structured' && { confidence: answer.confidence }), toolTrace, failed: false, hitMaxIterations: false, sideEffects, executionId };
        }

        messages.push({ role: 'assistant', content: completion.content ?? '', toolCalls: completion.toolCalls });
        for (const call of completion.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments || '{}'); } catch { /* tool handler validates required fields */ }
          // Arguments are model output: anything that is not a plain object (null, a string, an array) becomes an empty object so a handler never
          // indexes into a non-object, and the handler's own required-field validation answers the model.
          if (args === null || typeof args !== 'object' || Array.isArray(args)) args = {};
          const toolStartedAt = Date.now();
          const rawResult = offeredTools.has(call.name)
            ? await this.tools.execute(call.name, req.toolContext, args)
            : this.refuseUnofferedTool(call.name, req.conversationId);
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

  private refuseUnofferedTool(name: string, conversationId?: string): { error: string } {
    const safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
    this.logger.warn(`Refused a call to a tool that was not offered in this run (${safeName || 'unnamed'}) for conversation ${conversationId ?? 'unknown'}`);
    return { error: 'That tool is not available in this conversation.' };
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
          safetyFlags: { ...(req.traceMetadata ?? {}), ...(req.simulated ? { simulated: true } : {}) },
          stageTimings: {},
          toolTrace: toolTrace.length > 0 ? sanitizeToolTrace(toolTrace) : undefined,
          ...(reservationIds.length > 0 && { reservationIds }),
        },
      )
      .catch((err) => {
        this.logger.warn(`Failed to record AiExecution trace: ${describeErrorForLog(err)}`);
        return null;
      });
    return execution?.id;
  }
}
