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

export interface AiPricingSnapshot {
  creditsPerUsd: number;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export interface AiReservationQuote extends AiPricingSnapshot {
  maxCreditsPerAttempt: number;
  reservedCredits: number;
}

interface AiPricingConfigRow {
  creditsPerUsd: number;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
}

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
    return this.calculateCreditsForUsage(pricing, inputTokens, outputTokens);
  }

  async getReservationQuote(provider: string, modelKey: string, maxTokens: number | undefined, maxAttempts: number): Promise<AiReservationQuote> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('AI provider maxAttempts must be a positive integer');
    const model = getModelCatalogEntry(modelKey);
    const pricing = await this.getPricing(provider, modelKey, true);
    const maxOutputTokens = Math.max(0, Math.min(maxTokens ?? 400, model.contextWindow));
    const maxCreditsPerAttempt = this.calculateCreditsForUsage(pricing, model.contextWindow, maxOutputTokens);
    const reservedCredits = maxCreditsPerAttempt * maxAttempts;
    if (!Number.isSafeInteger(reservedCredits)) throw new Error(`AI reservation quote exceeds safe integer bounds for ${provider}:${modelKey}`);

    return {
      ...pricing,
      maxCreditsPerAttempt,
      reservedCredits,
    };
  }

  calculateCreditsForUsage(pricing: AiPricingSnapshot, inputTokens: number, outputTokens: number): number {
    const pricingValues = [pricing.creditsPerUsd, pricing.inputPerMTokUsd, pricing.outputPerMTokUsd, inputTokens, outputTokens];
    if (pricingValues.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('AI pricing and token usage values must be finite and non-negative');
    }
    const usd = (inputTokens / 1_000_000) * pricing.inputPerMTokUsd + (outputTokens / 1_000_000) * pricing.outputPerMTokUsd;
    const credits = Math.ceil(usd * pricing.creditsPerUsd);
    if (!Number.isSafeInteger(credits)) throw new Error('AI usage charge exceeds safe integer bounds');
    return credits;
  }

  private async getPricing(provider: string, modelKey: string, failClosed = false): Promise<AiPricingSnapshot> {
    const cacheKey = `${provider}:${modelKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;

    let row: AiPricingConfigRow | null;
    try {
      row = await this.prisma.aiPricingConfig.findFirst({ where: { provider, modelKey, isActive: true } });
    } catch (err) {
      if (failClosed) throw err;
      this.logger.warn(`Failed to load AiPricingConfig for ${cacheKey}: ${String(err)}`);
      row = null;
    }

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
