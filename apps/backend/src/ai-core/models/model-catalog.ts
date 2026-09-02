import { DEEPSEEK_MODEL } from '../../common/deepseek';

/**
 * Code-constant model catalog, not DB rows -- for a small team, DB-driven model
 * config means seed scripts + an admin UI + env drift for zero benefit, since
 * pricing/catalog changes ship as one-line deploys anyway. Adding a provider
 * later (e.g. Claude) means a new adapter file + one entry here, nothing else.
 *
 * The DeepSeek entry's key/providerModelId are DERIVED from DEEPSEEK_MODEL
 * (common/deepseek.ts) rather than a separate hardcoded literal, so that file
 * stays the single place cost-sensitive model selection changes -- this catalog
 * follows it automatically instead of risking drift between two constants.
 */

export type AiCapability = 'jsonMode' | 'tools';

export interface AiModelCatalogEntry {
  key: string;
  provider: string;
  providerModelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: AiCapability[];
  pricing: {
    inputPerMTokUsd: number;
    outputPerMTokUsd: number;
  };
  status: 'active' | 'deprecated';
}

export const MODEL_CATALOG: Readonly<Record<string, AiModelCatalogEntry>> = Object.freeze({
  [DEEPSEEK_MODEL]: {
    key: DEEPSEEK_MODEL,
    provider: 'deepseek',
    providerModelId: DEEPSEEK_MODEL,
    contextWindow: 64_000,
    maxOutputTokens: 4096,
    capabilities: ['jsonMode', 'tools'],
    pricing: {
      // ~$0.14/$0.28 per Mtok for deepseek-v4-flash, per common/deepseek.ts's own pricing note.
      // Cache-miss input rate used as the conservative default; Phase 1 does not attempt to
      // distinguish cache-hit vs cache-miss pricing.
      inputPerMTokUsd: 0.14,
      outputPerMTokUsd: 0.28,
    },
    status: 'active',
  },
});

/** The default model for new AiAgents -- always the current cheap-tier DeepSeek model. */
export const DEFAULT_MODEL_KEY = DEEPSEEK_MODEL;

export function getModelCatalogEntry(modelKey: string): AiModelCatalogEntry {
  const entry = MODEL_CATALOG[modelKey];
  if (!entry) {
    throw new Error(`Unknown AI model key: ${modelKey}`);
  }
  return entry;
}

export function estimateCostUsd(modelKey: string, inputTokens: number, outputTokens: number): number {
  const entry = getModelCatalogEntry(modelKey);
  return (inputTokens / 1_000_000) * entry.pricing.inputPerMTokUsd + (outputTokens / 1_000_000) * entry.pricing.outputPerMTokUsd;
}
