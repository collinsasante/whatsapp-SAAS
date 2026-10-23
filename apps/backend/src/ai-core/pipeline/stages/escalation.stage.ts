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
 * The response text is replaced with a deterministic handoff line rather
 * than trusting the model to mention the handoff itself -- the prompt has
 * no "you can escalate" instruction, so the model's own reply wouldn't
 * reliably say anything about connecting the customer to a person.
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
      ctx.result = {
        ...ctx.result,
        shouldEscalate: true,
        response: "I'll connect you with a team member who can help with this right away.",
      };
      ctx.trace.safetyFlags.humanEscalation = true;
      ctx.trace.safetyFlags.escalationReason = explicitRequest ? 'explicit_request' : 'low_confidence';
    }

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
