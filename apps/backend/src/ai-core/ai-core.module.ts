import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ApprovedCorrectionsModule } from '../ai-learning/corrections/approved-corrections.module';
import { InternalTasksModule } from '../internal-tasks/internal-tasks.module';
import { CommerceModule } from '../commerce/commerce.module';
import { AiLearningModule } from '../ai-learning/ai-learning.module';
import { AiProvidersModule } from './providers/ai-providers.module';
import { PromptsService } from './prompts/prompts.service';
import { AiAgentsService } from './agents/ai-agents.service';
import { AiAgentsController } from './agents/ai-agents.controller';
import { GuardStage } from './pipeline/stages/guard.stage';
import { ContextAssemblyStage } from './pipeline/stages/context-assembly.stage';
import { PromptBuildStage } from './pipeline/stages/prompt-build.stage';
import { GenerationStage } from './pipeline/stages/generation.stage';
import { PolicyStage } from './pipeline/stages/policy.stage';
import { EscalationStage } from './pipeline/stages/escalation.stage';
import { knowledgeSourceProviders } from './pipeline/knowledge-source.providers';
import { VerzAiPipelineService } from './pipeline/verz-ai-pipeline.service';
import { AiExecutionsService } from './executions/ai-executions.service';
import { SecurityRefusalService } from './refusal/security-refusal.service';
import { AiExecutionsController } from './executions/ai-executions.controller';
import { AiCompletionService } from './completion/ai-completion.service';
import { AiMeteredProviderService } from './completion/ai-metered-provider.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolCallingService } from './tools/tool-calling.service';
import { AiCreditsService } from './credits/ai-credits.service';
import { AiPricingService } from './pricing/ai-pricing.service';
import { DigitalSelfModule } from '../digital-self/digital-self.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiCapAlertNotifier } from './credits/ai-cap-alerts';

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
    DigitalSelfModule,
    NotificationsModule,
    PrismaModule,
    AiModule,
    forwardRef(() => KnowledgeBaseModule),
    ApprovedCorrectionsModule,
    InternalTasksModule,
    // ToolRegistryService needs ProductsService/OrdersService -- CommerceModule imports
    // AiCoreModule back (for ToolCallingService/ToolRegistryService, see commerce.module.ts),
    // so this is a genuine two-way edge, same forwardRef() pattern already established for
    // KnowledgeBaseModule <-> AiCoreModule above.
    forwardRef(() => CommerceModule),
    AiLearningModule,
    AiProvidersModule,
  ],
  controllers: [AiAgentsController, AiExecutionsController],
  providers: [
    PromptsService,
    AiAgentsService,
    AiExecutionsService,
    GuardStage,
    ContextAssemblyStage,
    PromptBuildStage,
    GenerationStage,
    PolicyStage,
    EscalationStage,
    ...knowledgeSourceProviders,
    VerzAiPipelineService,
    AiCompletionService,
    AiMeteredProviderService,
    ToolRegistryService,
    ToolCallingService,
    AiCreditsService,
    AiCapAlertNotifier,
    AiPricingService,
    SecurityRefusalService,
  ],
  exports: [AiProvidersModule, PromptsService, AiAgentsService, AiExecutionsService, VerzAiPipelineService, AiCompletionService, AiMeteredProviderService, ToolRegistryService, ToolCallingService, AiCreditsService, AiPricingService, SecurityRefusalService],
})
export class AiCoreModule {}
