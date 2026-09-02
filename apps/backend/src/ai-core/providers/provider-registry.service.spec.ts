import { DEFAULT_MODEL_KEY } from '../models/model-catalog';
import { DeepSeekProvider } from './deepseek.provider';
import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderRegistryService', () => {
  it('resolves the provider registered for a known model key', () => {
    const deepseek = new DeepSeekProvider();
    const registry = new ProviderRegistryService(deepseek);

    expect(registry.forModel(DEFAULT_MODEL_KEY)).toBe(deepseek);
  });

  it('throws for an unknown model key', () => {
    const registry = new ProviderRegistryService(new DeepSeekProvider());

    expect(() => registry.forModel('unknown-model')).toThrow('Unknown AI model key: unknown-model');
  });
});
