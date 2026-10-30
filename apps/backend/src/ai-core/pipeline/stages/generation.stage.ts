import { Injectable, Logger } from '@nestjs/common';
import { AiProviderError, ChatMessage } from '../../providers/ai-provider.interface';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { estimateCostUsd, getModelCatalogEntry } from '../../models/model-catalog';
import { ToolCallingService } from '../../tools/tool-calling.service';
import { deriveStateFromToolTrace } from '../../tools/state-derivation.util';
import { ConversationStateService } from '../../../conversations/conversation-state.service';
import { PipelineContext, PipelineStage } from '../pipeline.types';
import { MAX_ITERATIONS_FALLBACK_TEXT, PROVIDER_FAILURE_FALLBACK_TEXT } from '../../prompts/escalation-messages.util';
import { AiMeteredProviderService } from '../../completion/ai-metered-provider.service';
import { checkCustomerText, parseStructuredReply } from '../../completion/model-output.util';

@Injectable()
export class GenerationStage implements PipelineStage {
  readonly name = 'generation';
  private readonly logger = new Logger(GenerationStage.name);

  constructor(
    private registry: ProviderRegistryService,
    private toolCalling: ToolCallingService,
    private conversationState: ConversationStateService,
    private meteredProvider: AiMeteredProviderService,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    const userContent = ctx.input.contactName
      ? `Customer name: ${ctx.input.contactName}\nMessage: ${ctx.customerMessage}`
      : ctx.customerMessage;

    // Verz-AI unification, Phase A: when a run has tools available (ctx.tools --
    // nothing populates this yet, see pipeline.types.ts), delegate to the same shared
    // tool-calling engine CommerceAiService uses instead of this stage's own single-shot
    // completion. Final answers from a tool-calling run are plain text, not the
    // {response, confidence} JSON convention below -- confidence is left null in that
    // case, the same "no signal available" state PolicyStage/EscalationStage already
    // handle for a JSON-parse failure.
    if (ctx.tools?.length) {
      if (!ctx.toolContext) {
        this.logger.warn('ctx.tools set without ctx.toolContext -- running without tools this turn');
      } else {
        const result = await this.toolCalling.complete({
          tenantId: ctx.input.tenantId,
          taskType: ctx.input.taskType,
          simulated: ctx.input.simulated,
          conversationId: ctx.input.conversationId,
          agentId: ctx.input.agentId,
          systemPrompt: ctx.renderedSystemPrompt ?? '',
          historyMessages: ctx.historyMessages,
          userMessage: userContent,
          toolNames: ctx.tools,
          toolContext: ctx.toolContext,
          modelKey: ctx.modelKey,
          maxTokens: ctx.maxResponseTokens,
        });

        // Deterministic half of state tracking -- reads whatever tools actually
        // ran this turn regardless of the outcome below. Never throws.
        void this.conversationState.mergeState(ctx.input.tenantId, ctx.input.conversationId, deriveStateFromToolTrace(result.toolTrace));

        const toolText = result.failed || result.hitMaxIterations ? null : checkCustomerText(result.content);
        if (result.failed || (toolText && !toolText.safe)) {
          if (toolText && !toolText.safe) this.logger.warn(`Generation (tool-calling) output rejected (${toolText.reason}) for conversation ${ctx.input.conversationId}; nothing sent to the customer`);
          // Verz-AI unification, Phase L: previously this left response empty with no
          // shouldEscalate -- messages.service.ts's `if (!result?.response) return;`
          // then silently dropped the turn, so a genuine provider failure (the provider
          // client has already retried once internally by this point) produced total
          // silence for the customer. Same shouldEscalate mechanism the
          // hitMaxIterations branch just below already relies on.
          this.logger.warn(`Generation (tool-calling) provider call failed for conversation ${ctx.input.conversationId}`);
          ctx.result = {
            response: PROVIDER_FAILURE_FALLBACK_TEXT,
            confidence: null, blocked: false, shouldEscalate: true,
          };
          ctx.trace.status = 'PROVIDER_ERROR';
        } else if (result.hitMaxIterations) {
          // Verz-AI unification, Phase I: previously this branch returned an empty
          // response with no escalation signal at all -- worse than Commerce's own
          // (also-fixed) hitMaxIterations fallback, since it wasn't even a line of
          // text. This stage can't call ConversationsService directly (would create
          // a circular import), but doesn't need to: shouldEscalate is enough --
          // messages.service.ts already acts on that flag in both
          // handleAiAutoReply/handleAiSuggestion, and EscalationStage (which runs
          // right after this stage) only ever adds escalation, never clears it.
          ctx.result = {
            response: MAX_ITERATIONS_FALLBACK_TEXT,
            confidence: null, blocked: false, shouldEscalate: true,
          };
          ctx.trace.status = 'SUCCESS';
        } else {
          ctx.result = { response: result.content, confidence: null, blocked: false, mediaToSend: result.sideEffects };
          ctx.trace.status = 'SUCCESS';
        }
        // ToolCallingService.complete() already wrote its own AiExecution row
        // (with real tokens/cost) internally -- see PipelineTrace.alreadyRecorded's
        // doc comment. This ctx.trace has no token/cost data to contribute.
        ctx.trace.alreadyRecorded = true;
        ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
        return;
      }
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: ctx.renderedSystemPrompt ?? '' },
      ...ctx.historyMessages,
      { role: 'user', content: userContent },
    ];

    const provider = this.registry.forModel(ctx.modelKey);
    const catalogEntry = getModelCatalogEntry(ctx.modelKey);

    try {
      const meteredCompletion = await this.meteredProvider.complete(provider, ctx.input.tenantId, ctx.input.taskType, {
        modelKey: ctx.modelKey,
        messages,
        maxTokens: ctx.maxResponseTokens,
        jsonMode: catalogEntry.capabilities.includes('jsonMode'),
      });
      const completion = meteredCompletion.result;

      ctx.trace.provider = completion.provider;
      ctx.trace.modelKey = ctx.modelKey;
      if (meteredCompletion.reservationId) ctx.trace.reservationIds = [meteredCompletion.reservationId];
      ctx.trace.inputTokens = completion.usage.inputTokens;
      ctx.trace.outputTokens = completion.usage.outputTokens;
      ctx.trace.estCostUsd = estimateCostUsd(ctx.modelKey, completion.usage.inputTokens, completion.usage.outputTokens);

      // Only a clean reply is used. Cut-off or malformed JSON, provider error text and the like take the same
      // recovery path as a provider failure below (standard fallback text and a real handoff), never the customer.
      const parsed = parseStructuredReply(completion.content);
      if (!parsed.ok) throw new AiProviderError('parse_error', `Model output rejected: ${parsed.reason}`, false);
      ctx.result = { response: parsed.response, confidence: parsed.confidence, blocked: false };
      ctx.trace.status = 'SUCCESS';
      ctx.trace.confidence = parsed.confidence;
    } catch (err) {
      const providerErr = err instanceof AiProviderError ? err : new AiProviderError('network', String(err), false, err);
      this.logger.warn(`Generation failed (${providerErr.code}): ${providerErr.message}`);
      // Verz-AI unification, Phase L: same silent-failure fix as the tool-calling
      // branch above -- an empty response with no shouldEscalate meant the customer
      // got nothing at all when the provider call itself threw.
      ctx.result = {
        response: PROVIDER_FAILURE_FALLBACK_TEXT,
        confidence: null, blocked: false, shouldEscalate: true,
      };
      ctx.trace.status = 'PROVIDER_ERROR';
      ctx.trace.errorCode = providerErr.code;
      ctx.trace.errorMessage = providerErr.message;
    }

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
