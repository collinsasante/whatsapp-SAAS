import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { PromptsService } from './prompts/prompts.service';

/**
 * Verz-AI Phase 1 foundation. Built strangler-style alongside the existing
 * `ai/` module (AiResponderService) -- that module is untouched; this one is
 * additive and only reached when a tenant's `verz_ai_v2` feature flag is on.
 */
@Module({
  imports: [PrismaModule],
  providers: [DeepSeekProvider, ProviderRegistryService, PromptsService],
  exports: [ProviderRegistryService, PromptsService],
})
export class AiCoreModule {}
