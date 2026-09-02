import { Injectable } from '@nestjs/common';
import { PipelineContext, PipelineStage } from '../pipeline.types';

// Fallback responses are knowledge gaps -- cap confidence so they correctly
// surface as low-confidence and trigger human review. Ported verbatim from
// the legacy responder's post-processing.
const FALLBACK_SIGNALS = ['team will follow up', 'team member will assist', 'great question'];

@Injectable()
export class PolicyStage implements PipelineStage {
  readonly name = 'policy';

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    if (ctx.shortCircuit || !ctx.result) {
      ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
      return;
    }

    const { response, confidence } = ctx.result;

    if (confidence !== null && FALLBACK_SIGNALS.some((s) => response.toLowerCase().includes(s))) {
      const capped = Math.min(confidence, 40);
      ctx.result = { ...ctx.result, confidence: capped };
      ctx.trace.confidence = capped;
      ctx.trace.safetyFlags.fallbackCapped = true;
    }

    if (!response && ctx.trace.status === 'SUCCESS') {
      ctx.trace.status = 'EMPTY';
      ctx.trace.safetyFlags.emptyOutput = true;
    }

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
