import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { detectInjection } from '../../guards/injection-patterns';
import { PipelineContext, PipelineStage } from '../pipeline.types';

/**
 * Injection check runs first and cheaply, before any other DB/LLM work --
 * matching the legacy responder's ordering exactly (detectInjection() is the
 * very first thing it does, before even the settings/history queries).
 */
@Injectable()
export class GuardStage implements PipelineStage {
  readonly name = 'guard';

  constructor(private prisma: PrismaService) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();
    if (detectInjection(ctx.customerMessage)) {
      const settings = await this.prisma.tenantSettings.findUnique({
        where: { tenantId: ctx.input.tenantId },
        select: { businessName: true },
      });
      const businessName = settings?.businessName ?? 'our business';

      ctx.result = {
        response: `I'm here to help with questions about ${businessName}. How can I assist you today?`,
        confidence: 100,
        blocked: true,
      };
      ctx.shortCircuit = true;
      ctx.trace.status = 'BLOCKED';
      ctx.trace.safetyFlags.injectionDetected = true;
    }
    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
