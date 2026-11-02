import { Injectable } from '@nestjs/common';
import { detectHumanRequest, shouldEscalateOnConfidence } from '../escalation-detector.util';
import { PipelineContext, PipelineStage } from '../pipeline.types';

/**
 * Runs last, after generation + policy: decides whether this conversation
 * needs a human, but does not act on it -- moving the conversation to the
 * REQUESTED queue is the caller's job (messages.service.ts), which already
 * owns conversation-state changes and already has ConversationsService
 * injected. Keeping the mutation out of ai-core avoids a new circular
 * module dependency (ConversationsModule already imports AiCoreModule, for
 * AiCompletionService).
 *
 * The model's own reply is left as written: only the escalation signal is
 * added, so what the customer reads is never a canned line.
 */
@Injectable()
export class EscalationStage implements PipelineStage {
  readonly name = 'escalation';

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    if (ctx.shortCircuit || !ctx.result) {
      ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
      return;
    }

    const explicitRequest = detectHumanRequest(ctx.customerMessage);
    const lowConfidence = shouldEscalateOnConfidence(ctx.result.confidence);

    if (explicitRequest || lowConfidence) {
      ctx.result = { ...ctx.result, shouldEscalate: true };
      ctx.trace.safetyFlags.humanEscalation = true;
      ctx.trace.safetyFlags.escalationReason = explicitRequest ? 'explicit_request' : 'low_confidence';
    }

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
