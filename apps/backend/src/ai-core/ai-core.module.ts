import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { InternalTasksModule } from '../internal-tasks/internal-tasks.module';
import { CommerceModule } from '../commerce/commerce.module';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { PromptsService } from './prompts/prompts.service';
import { AiAgentsService } from './agents/ai-agents.service';
import { AiAgentsController } from './agents/ai-agents.controller';
import { GuardStage } from './pipeline/stages/guard.stage';
import { ContextAssemblyStage } from './pipeline/stages/context-assembly.stage';
import { PromptBuildStage } from './pipeline/stages/prompt-build.stage';
import { GenerationStage } from './pipeline/stages/generation.stage';
import { PolicyStage } from './pipeline/stages/policy.stage';
import { EscalationStage } from './pipeline/stages/escalation.stage';
import { KNOWLEDGE_CONTEXT_SOURCE, KbRelevantContextSource } from './pipeline/knowledge-context.source';
import { VerzAiPipelineService } from './pipeline/verz-ai-pipeline.service';
import { AiExecutionsService } from './executions/ai-executions.service';
import { AiExecutionsController } from './executions/ai-executions.controller';
import { AiCompletionService } from './completion/ai-completion.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolCallingService } from './tools/tool-calling.service';

/**
 * Verz-AI Phase 1 foundation. Built strangler-style alongside the existing
 * `ai/` module (AiResponderService) -- that module is untouched; this one is
 * additive and only reached when a tenant's `verz_ai_v2` feature flag is on.
 * Imports AiModule so AiAgentsService can reuse AiResponderService's
 * findOrCreateVerzAgent -- the default agent must share the SAME synthetic
 * isAiAgent User row the legacy responder already uses, not a second one.
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    forwardRef(() => KnowledgeBaseModule),
    InternalTasksModule,
    // ToolRegistryService needs ProductsService/OrdersService -- CommerceModule imports
    // AiCoreModule back (for ToolCallingService/ToolRegistryService, see commerce.module.ts),
    // so this is a genuine two-way edge, same forwardRef() pattern already established for
    // KnowledgeBaseModule <-> AiCoreModule above.
    forwardRef(() => CommerceModule),
  ],
  controllers: [AiAgentsController, AiExecutionsController],
  providers: [
    DeepSeekProvider,
    ProviderRegistryService,
    PromptsService,
    AiAgentsService,
    AiExecutionsService,
    GuardStage,
    ContextAssemblyStage,
    PromptBuildStage,
    GenerationStage,
    PolicyStage,
    EscalationStage,
    { provide: KNOWLEDGE_CONTEXT_SOURCE, useClass: KbRelevantContextSource },
    VerzAiPipelineService,
    AiCompletionService,
    ToolRegistryService,
    ToolCallingService,
  ],
  exports: [ProviderRegistryService, PromptsService, AiAgentsService, AiExecutionsService, VerzAiPipelineService, AiCompletionService, ToolRegistryService, ToolCallingService],
})
export class AiCoreModule {}
