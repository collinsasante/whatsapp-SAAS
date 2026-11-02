import { Module } from '@nestjs/common';
import { DeepSeekProvider } from './deepseek.provider';
import { ProviderRegistryService } from './provider-registry.service';

/**
 * Provider adapters and their registry, on their own so that modules which only need to call a model (the AI Learning evaluator)
 * can import them without importing AiCoreModule. AiCoreModule imports AiLearningModule, so AiLearningModule importing AiCoreModule
 * back would be a dependency cycle. Depends on nothing (no Prisma, no Redis): it is safe to import from anywhere.
 */
@Module({
  providers: [DeepSeekProvider, ProviderRegistryService],
  exports: [DeepSeekProvider, ProviderRegistryService],
})
export class AiProvidersModule {}
