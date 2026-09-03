import { Injectable, Logger } from '@nestjs/common';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { AiProviderError, ChatMessage } from '../providers/ai-provider.interface';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { DEFAULT_MODEL_KEY, estimateCostUsd } from '../models/model-catalog';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutionContext } from './tool-registry.types';

const DEFAULT_MAX_ITERATIONS = 4;

export interface ToolCallingRequest {
  tenantId: string;
  taskType: AiTaskType;
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
  ) {}

  async complete(req: ToolCallingRequest): Promise<ToolCallingResult> {
    const modelKey = req.modelKey ?? DEFAULT_MODEL_KEY;
    const maxIterations = req.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const provider = this.registry.forModel(modelKey);
    const toolDefs = this.tools.getDefs(req.toolNames);
    const toolTrace: ToolCallTrace[] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: req.systemPrompt },
      ...req.historyMessages,
      { role: 'user', content: req.userMessage },
    ];

    const startedAt = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastProvider = 'deepseek';

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const completion = await provider.complete({
          modelKey,
          messages,
          maxTokens: req.maxTokens,
          ...(toolDefs.length && { tools: toolDefs }),
        });
        totalInputTokens += completion.usage.inputTokens;
        totalOutputTokens += completion.usage.outputTokens;
        lastProvider = completion.provider;

        if (!completion.toolCalls.length) {
          await this.trace(req, {
            status: 'SUCCESS', provider: lastProvider, modelKey,
            latencyMs: Date.now() - startedAt, inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            estCostUsd: estimateCostUsd(modelKey, totalInputTokens, totalOutputTokens),
          });
          return { content: completion.content, toolTrace, failed: false, hitMaxIterations: false };
        }

        messages.push({ role: 'assistant', content: completion.content ?? '', toolCalls: completion.toolCalls });
        for (const call of completion.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments || '{}'); } catch { /* tool handler validates required fields */ }
          const result = await this.tools.execute(call.name, req.toolContext, args);
          toolTrace.push({ name: call.name, args, result });
          messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: call.id });
        }
      }

      this.logger.warn(`Tool-calling hit max iterations (${maxIterations}) for conversation ${req.conversationId ?? 'unknown'}`);
      await this.trace(req, {
        status: 'SUCCESS', provider: lastProvider, modelKey,
        latencyMs: Date.now() - startedAt, inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        estCostUsd: estimateCostUsd(modelKey, totalInputTokens, totalOutputTokens),
      });
      return { content: '', toolTrace, failed: false, hitMaxIterations: true };
    } catch (err) {
      const providerErr = err instanceof AiProviderError ? err : new AiProviderError('network', String(err), false, err);
      this.logger.warn(`Tool-calling call failed (${req.taskType}, ${providerErr.code}): ${providerErr.message}`);
      await this.trace(req, {
        status: 'PROVIDER_ERROR', provider: 'deepseek', modelKey,
        latencyMs: Date.now() - startedAt, errorCode: providerErr.code, errorMessage: providerErr.message,
      });
      return { content: '', toolTrace, failed: true, hitMaxIterations: false };
    }
  }

  private async trace(
    req: ToolCallingRequest,
    trace: {
      status: 'SUCCESS' | 'PROVIDER_ERROR'; provider: string; modelKey: string; latencyMs: number;
      inputTokens?: number; outputTokens?: number; estCostUsd?: number; errorCode?: string; errorMessage?: string;
    },
  ) {
    await this.executions
      .record(
        { tenantId: req.tenantId, agentId: req.agentId, conversationId: req.conversationId, taskType: req.taskType },
        { ...trace, safetyFlags: {}, stageTimings: {} },
      )
      .catch((err) => this.logger.warn(`Failed to record AiExecution trace: ${String(err)}`));
  }
}
