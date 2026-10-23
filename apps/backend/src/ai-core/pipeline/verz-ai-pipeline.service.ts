import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { GuardStage } from './stages/guard.stage';
import { ContextAssemblyStage } from './stages/context-assembly.stage';
import { PromptBuildStage } from './stages/prompt-build.stage';
import { GenerationStage } from './stages/generation.stage';
import { PolicyStage } from './stages/policy.stage';
import { EscalationStage } from './stages/escalation.stage';
import { newTrace, PipelineContext, PipelineInput, PipelineStage, VerzAiResult } from './pipeline.types';
import { resolveToolNames } from './tool-capability.util';

@Injectable()
export class VerzAiPipelineService {
  private readonly logger = new Logger(VerzAiPipelineService.name);
  private readonly stages: PipelineStage[];

  constructor(
    private prisma: PrismaService,
    private executions: AiExecutionsService,
    guard: GuardStage,
    contextAssembly: ContextAssemblyStage,
    promptBuild: PromptBuildStage,
    generation: GenerationStage,
    policy: PolicyStage,
    escalation: EscalationStage,
  ) {
    this.stages = [guard, contextAssembly, promptBuild, generation, policy, escalation];
  }

  /**
   * Runs the full Verz-AI pipeline for one inbound customer message and returns
   * a result shape identical to the legacy AiSuggestionResult, so callers can
   * substitute this in place of AiResponderService.generateSuggestion() with no
   * downstream changes. Always persists an AiExecution trace, even on error --
   * that's the whole point of tracing, so it must never depend on the happy path.
   * Returns { executionId, ...result } so the caller can link its AiInteractionLog.
   */
  async run(input: PipelineInput): Promise<VerzAiResult & { executionId: string | null }> {
    const startedAt = Date.now();
    const agent = await this.prisma.aiAgent.findFirst({ where: { id: input.agentId, tenantId: input.tenantId } });
    if (!agent) throw new NotFoundException(`AI agent ${input.agentId} not found for tenant ${input.tenantId}`);

    const ctx: PipelineContext = {
      input,
      businessName: '',
      personality: agent.personality ?? 'You are helpful, friendly, and professional. Keep replies concise and conversational.',
      systemInstructions: agent.systemInstructions ?? '',
      modelKey: agent.modelKey,
      maxResponseTokens: agent.maxResponseTokens,
      customerMessage: input.customerMessage,
      historyMessages: [],
      knowledgeContext: '',
      shortCircuit: false,
      trace: newTrace(),
      // Verz-AI unification, Phase E: turns GenerationStage's tool-calling branch
      // live for the first time in production -- previously nothing ever set these.
      ...(input.contactId && input.customerPhone
        ? {
            tools: resolveToolNames({ readOnlyTools: !!input.readOnlyTools }),
            toolContext: {
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              contactId: input.contactId,
              customerPhone: input.customerPhone,
            },
          }
        : {}),
    };

    let executionId: string | null = null;
    try {
      for (const stage of this.stages) {
        await stage.execute(ctx);
        if (ctx.shortCircuit) break;
      }
      if (!ctx.result) {
        // Defensive: a stage completed without setting a result (shouldn't happen given
        // the stage list above always ends in generation+policy, but never silently
        // return undefined -- that would crash the caller instead of degrading gracefully).
        ctx.result = { response: '', confidence: null, blocked: false };
      }
    } catch (err) {
      this.logger.error(`Pipeline run failed unexpectedly for conversation ${input.conversationId}`, err instanceof Error ? err.stack : String(err));
      ctx.trace.status = 'PROVIDER_ERROR';
      ctx.trace.errorCode = 'network';
      ctx.trace.errorMessage = err instanceof Error ? err.message : String(err);
      ctx.result = { response: '', confidence: null, blocked: false };
    } finally {
      ctx.trace.latencyMs = Date.now() - startedAt;
      // GenerationStage's tools branch already recorded a real AiExecution row
      // (via ToolCallingService's own trace() call) -- recording again here
      // would double-write, and once credit charging is wired to
      // AiExecutionsService.record(), double-charge. See
      // PipelineTrace.alreadyRecorded's doc comment.
      if (!ctx.trace.alreadyRecorded) {
        try {
          const execution = await this.executions.record(input, ctx.trace);
          executionId = execution.id;
        } catch (traceErr) {
          // Tracing must never be why a customer doesn't get a reply.
          this.logger.error('Failed to persist AiExecution trace', traceErr instanceof Error ? traceErr.stack : String(traceErr));
        }
      }
    }

    return { ...ctx.result, executionId };
  }
}
