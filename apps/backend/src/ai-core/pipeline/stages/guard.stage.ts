import { Injectable } from '@nestjs/common';
import { detectInjection } from '../../guards/injection-patterns';
import { PipelineContext, PipelineStage } from '../pipeline.types';

/**
 * Injection check runs first and cheaply, before any other DB/LLM work --
 * matching the legacy responder's ordering exactly (detectInjection() is the
 * very first thing it does, before even the settings/history queries).
 *
 * It blocks and writes no customer text: the caller has SecurityRefusalService write the refusal in the workspace's
 * own voice, without ever showing it the blocked message.
 */
@Injectable()
export class GuardStage implements PipelineStage {
  readonly name = 'guard';

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();
    if (detectInjection(ctx.customerMessage)) {
      ctx.result = { response: '', confidence: 100, blocked: true };
      ctx.shortCircuit = true;
      ctx.trace.status = 'BLOCKED';
      ctx.trace.safetyFlags.injectionDetected = true;
    }
    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
