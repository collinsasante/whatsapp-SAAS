import { Injectable, Logger } from '@nestjs/common';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { AiProviderError, ChatMessage } from '../providers/ai-provider.interface';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { DEFAULT_MODEL_KEY, estimateCostUsd } from '../models/model-catalog';

export interface AiCompletionRequest {
  tenantId: string;
  taskType: AiTaskType;
  conversationId?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
  modelKey?: string;
}

export interface AiCompletionResult {
  content: string;
  /** True if the call failed (missing key, provider error) -- content is '' in that case. */
  failed: boolean;
}

/**
 * Thin registry wrapper for non-pipeline callers (conversation summarize,
 * KB-learn, the /ai-logs/test sandbox once flagged) that need a single
 * completion, not the full 5-stage response pipeline (no guard/context/prompt
 * stages -- each caller builds its own prompt today). Still gets tracing for
 * free, which these call sites never had before: summarize's native `fetch`
 * had no timeout at all; KB-learn's axios.post had none either. Never throws
 * -- callers keep their own existing fallback behavior on failure.
 */
@Injectable()
export class AiCompletionService {
  private readonly logger = new Logger(AiCompletionService.name);

  constructor(
    private registry: ProviderRegistryService,
    private executions: AiExecutionsService,
  ) {}

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const modelKey = req.modelKey ?? DEFAULT_MODEL_KEY;
    const startedAt = Date.now();
    const provider = this.registry.forModel(modelKey);

    try {
      const result = await provider.complete({
        modelKey,
        messages: req.messages,
        maxTokens: req.maxTokens,
        jsonMode: req.jsonMode,
      });

      await this.executions.record(
        { tenantId: req.tenantId, conversationId: req.conversationId, taskType: req.taskType },
        {
          status: 'SUCCESS',
          provider: result.provider,
          modelKey,
          latencyMs: Date.now() - startedAt,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estCostUsd: estimateCostUsd(modelKey, result.usage.inputTokens, result.usage.outputTokens),
          safetyFlags: {},
          stageTimings: {},
        },
      ).catch((err) => this.logger.warn(`Failed to record AiExecution trace: ${String(err)}`));

      return { content: result.content, failed: false };
    } catch (err) {
      const providerErr = err instanceof AiProviderError ? err : new AiProviderError('network', String(err), false, err);
      this.logger.warn(`AiCompletionService call failed (${req.taskType}, ${providerErr.code}): ${providerErr.message}`);

      await this.executions.record(
        { tenantId: req.tenantId, conversationId: req.conversationId, taskType: req.taskType },
        {
          status: 'PROVIDER_ERROR',
          provider: 'deepseek',
          modelKey,
          latencyMs: Date.now() - startedAt,
          errorCode: providerErr.code,
          errorMessage: providerErr.message,
          safetyFlags: {},
          stageTimings: {},
        },
      ).catch((traceErr) => this.logger.warn(`Failed to record AiExecution trace: ${String(traceErr)}`));

      return { content: '', failed: true };
    }
  }
}
