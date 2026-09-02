import { Injectable, Logger } from '@nestjs/common';
import { AiProviderError, ChatMessage } from '../../providers/ai-provider.interface';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { estimateCostUsd, getModelCatalogEntry } from '../../models/model-catalog';
import { PipelineContext, PipelineStage } from '../pipeline.types';

interface ParsedGeneration {
  response?: string;
  confidence?: number;
}

@Injectable()
export class GenerationStage implements PipelineStage {
  readonly name = 'generation';
  private readonly logger = new Logger(GenerationStage.name);

  constructor(private registry: ProviderRegistryService) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    const userContent = ctx.input.contactName
      ? `Customer name: ${ctx.input.contactName}\nMessage: ${ctx.customerMessage}`
      : ctx.customerMessage;

    const messages: ChatMessage[] = [
      { role: 'system', content: ctx.renderedSystemPrompt ?? '' },
      ...ctx.historyMessages,
      { role: 'user', content: userContent },
    ];

    const provider = this.registry.forModel(ctx.modelKey);
    const catalogEntry = getModelCatalogEntry(ctx.modelKey);

    try {
      const completion = await provider.complete({
        modelKey: ctx.modelKey,
        messages,
        maxTokens: ctx.maxResponseTokens,
        jsonMode: catalogEntry.capabilities.includes('jsonMode'),
      });

      ctx.trace.provider = completion.provider;
      ctx.trace.modelKey = ctx.modelKey;
      ctx.trace.inputTokens = completion.usage.inputTokens;
      ctx.trace.outputTokens = completion.usage.outputTokens;
      ctx.trace.estCostUsd = estimateCostUsd(ctx.modelKey, completion.usage.inputTokens, completion.usage.outputTokens);

      const raw = completion.content.trim();
      try {
        const parsed = JSON.parse(raw) as ParsedGeneration;
        const response = (parsed.response ?? '').trim();
        const confidence = typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.confidence))) : null;
        ctx.result = { response, confidence, blocked: false };
        ctx.trace.status = 'SUCCESS';
        ctx.trace.confidence = confidence;
      } catch {
        // Parity with legacy: an unparseable body still returns the raw text as the
        // response rather than failing the whole interaction.
        ctx.result = { response: raw, confidence: null, blocked: false };
        ctx.trace.status = 'SUCCESS';
        ctx.trace.confidence = null;
      }
    } catch (err) {
      const providerErr = err instanceof AiProviderError ? err : new AiProviderError('network', String(err), false, err);
      this.logger.warn(`Generation failed (${providerErr.code}): ${providerErr.message}`);
      ctx.result = { response: '', confidence: null, blocked: false };
      ctx.trace.status = 'PROVIDER_ERROR';
      ctx.trace.errorCode = providerErr.code;
      ctx.trace.errorMessage = providerErr.message;
    }

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
