import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { PromptsService } from './prompts/prompts.service';
import { AiAgentsService } from './agents/ai-agents.service';
import { AiAgentsController } from './agents/ai-agents.controller';

/**
 * Verz-AI Phase 1 foundation. Built strangler-style alongside the existing
 * `ai/` module (AiResponderService) -- that module is untouched; this one is
 * additive and only reached when a tenant's `verz_ai_v2` feature flag is on.
 * Imports AiModule so AiAgentsService can reuse AiResponderService's
 * findOrCreateVerzAgent -- the default agent must share the SAME synthetic
 * isAiAgent User row the legacy responder already uses, not a second one.
 */
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [AiAgentsController],
  providers: [DeepSeekProvider, ProviderRegistryService, PromptsService, AiAgentsService],
  exports: [ProviderRegistryService, PromptsService, AiAgentsService],
})
export class AiCoreModule {}
