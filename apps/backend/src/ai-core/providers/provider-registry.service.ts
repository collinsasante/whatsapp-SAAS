import { Injectable } from '@nestjs/common';
import { getModelCatalogEntry } from '../models/model-catalog';
import { AiProvider, AiProviderError } from './ai-provider.interface';
import { DeepSeekProvider } from './deepseek.provider';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Map<string, AiProvider>;

  constructor(deepseek: DeepSeekProvider) {
    this.providers = new Map([[deepseek.key, deepseek]]);
  }

  /** Resolves the AiProvider registered for a model key's catalog entry. */
  forModel(modelKey: string): AiProvider {
    const entry = getModelCatalogEntry(modelKey);
    const provider = this.providers.get(entry.provider);
    if (!provider) {
      throw new AiProviderError('invalid_request', `No provider registered for "${entry.provider}" (model ${modelKey})`, false);
    }
    return provider;
  }
}
