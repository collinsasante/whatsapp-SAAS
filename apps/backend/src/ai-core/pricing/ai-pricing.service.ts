import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getModelCatalogEntry } from '../models/model-catalog';

/** Seeded automatically when no AiPricingConfig row exists yet for a
 * provider/model, so credit charging works correctly on day one without
 * requiring a manual DB write first. Mirrors model-catalog.ts's current
 * DeepSeek pricing; creditsPerUsd is a conservative starting margin,
 * intended to be tuned via the admin pricing API once real usage data
 * exists -- not a final business decision baked into code. */
const FALLBACK_CREDITS_PER_USD = 2000;

const CACHE_TTL_MS = 60_000;

/**
 * The only place AI-usage-to-credit conversion happens. model-catalog.ts
 * stays the source of truth for provider *capabilities* (context window,
 * tool support); pricing specifically lives here, DB-backed
 * (AiPricingConfig), so an admin can change cost-per-token and margin
 * without a deploy -- the explicit requirement this exists for.
 */
@Injectable()
export class AiPricingService {
  private readonly logger = new Logger(AiPricingService.name);
  private cache = new Map<string, { creditsPerUsd: number; inputPerMTokUsd: number; outputPerMTokUsd: number; cachedAt: number }>();

  constructor(private prisma: PrismaService) {}

  /** Whole, always-rounded-up credits for a completed call -- rounding up
   * means Verz never under-recovers real provider spend by a fraction of a
   * credit; the customer-facing unit is credits, never fractional. */
  async getCreditsForUsage(provider: string, modelKey: string, inputTokens: number, outputTokens: number): Promise<number> {
    const pricing = await this.getPricing(provider, modelKey);
    const usd = (inputTokens / 1_000_000) * pricing.inputPerMTokUsd + (outputTokens / 1_000_000) * pricing.outputPerMTokUsd;
    return Math.ceil(usd * pricing.creditsPerUsd);
  }

  private async getPricing(provider: string, modelKey: string) {
    const cacheKey = `${provider}:${modelKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;

    const row = await this.prisma.aiPricingConfig.findFirst({ where: { provider, modelKey, isActive: true } }).catch((err) => {
      this.logger.warn(`Failed to load AiPricingConfig for ${cacheKey}: ${String(err)}`);
      return null;
    });

    const resolved = row
      ? { creditsPerUsd: row.creditsPerUsd, inputPerMTokUsd: row.inputCostPerMillionUsd, outputPerMTokUsd: row.outputCostPerMillionUsd }
      : this.fallbackPricing(modelKey);

    const entry = { ...resolved, cachedAt: Date.now() };
    this.cache.set(cacheKey, entry);
    return entry;
  }

  private fallbackPricing(modelKey: string) {
    try {
      const catalogEntry = getModelCatalogEntry(modelKey);
      return {
        inputPerMTokUsd: catalogEntry.pricing.inputPerMTokUsd,
        outputPerMTokUsd: catalogEntry.pricing.outputPerMTokUsd,
        creditsPerUsd: FALLBACK_CREDITS_PER_USD,
      };
    } catch {
      // Unknown model key -- conservative fallback rather than throwing,
      // since a pricing lookup failure must never block a reply that's
      // already been generated.
      return { inputPerMTokUsd: 0.14, outputPerMTokUsd: 0.28, creditsPerUsd: FALLBACK_CREDITS_PER_USD };
    }
  }
}
