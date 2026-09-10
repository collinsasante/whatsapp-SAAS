import { DEFAULT_MODEL_KEY, estimateCostUsd, getModelCatalogEntry, MODEL_CATALOG } from './model-catalog';

describe('model-catalog', () => {
  describe('getModelCatalogEntry', () => {
    it('returns the catalog entry for the default model key', () => {
      const entry = getModelCatalogEntry(DEFAULT_MODEL_KEY);
      expect(entry.provider).toBe('deepseek');
      expect(entry.status).toBe('active');
    });

    it('throws for an unknown model key', () => {
      expect(() => getModelCatalogEntry('gpt-nonexistent')).toThrow('Unknown AI model key: gpt-nonexistent');
    });
  });

  describe('estimateCostUsd', () => {
    it('computes cost from input/output token pricing', () => {
      const entry = MODEL_CATALOG[DEFAULT_MODEL_KEY];
      const cost = estimateCostUsd(DEFAULT_MODEL_KEY, 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(entry.pricing.inputPerMTokUsd + entry.pricing.outputPerMTokUsd, 6);
    });

    it('returns 0 for zero tokens', () => {
      expect(estimateCostUsd(DEFAULT_MODEL_KEY, 0, 0)).toBe(0);
    });

    it('scales linearly with token count', () => {
      const small = estimateCostUsd(DEFAULT_MODEL_KEY, 100, 0);
      const large = estimateCostUsd(DEFAULT_MODEL_KEY, 1000, 0);
      expect(large).toBeCloseTo(small * 10, 9);
    });

    it('throws for an unknown model key', () => {
      expect(() => estimateCostUsd('unknown-model', 100, 100)).toThrow();
    });
  });
});
