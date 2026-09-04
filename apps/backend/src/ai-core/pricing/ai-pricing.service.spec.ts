import { AiPricingService } from './ai-pricing.service';
import { DEEPSEEK_MODEL } from '../../common/deepseek';

function buildPrismaMock() {
  return { aiPricingConfig: { findFirst: jest.fn().mockResolvedValue(null) } };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AiPricingService(prisma as any);
}

describe('AiPricingService', () => {
  describe('getCreditsForUsage', () => {
    it('converts usage to whole credits using an active DB pricing config', async () => {
      const prisma = buildPrismaMock();
      prisma.aiPricingConfig.findFirst.mockResolvedValue({
        inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 2, creditsPerUsd: 1000,
      });
      const service = buildService(prisma);

      // 1_000_000 input tokens @ $1/M = $1, 500_000 output @ $2/M = $1 -> $2 * 1000 credits/$ = 2000
      const credits = await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 1_000_000, 500_000);

      expect(credits).toBe(2000);
    });

    it('always rounds up so real provider spend is never under-recovered', async () => {
      const prisma = buildPrismaMock();
      prisma.aiPricingConfig.findFirst.mockResolvedValue({
        inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1, creditsPerUsd: 1,
      });
      const service = buildService(prisma);

      const credits = await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 1000, 0);

      expect(credits).toBe(1); // 0.001 credits owed -> rounds up to 1, never 0
    });

    it('falls back to model-catalog pricing when no DB config exists yet, so day-one charging works', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const credits = await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 1_000_000, 1_000_000);

      expect(credits).toBeGreaterThan(0);
    });

    it('falls back safely for an unknown model key rather than throwing', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      await expect(service.getCreditsForUsage('deepseek', 'unknown-model', 1000, 1000)).resolves.toEqual(expect.any(Number));
    });

    it('treats zero tokens (a failed/blocked call) as zero credits owed', async () => {
      const prisma = buildPrismaMock();
      prisma.aiPricingConfig.findFirst.mockResolvedValue({
        inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1, creditsPerUsd: 1000,
      });
      const service = buildService(prisma);

      const credits = await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 0, 0);

      expect(credits).toBe(0);
    });

    it('only queries the DB once within the cache TTL for the same provider/model', async () => {
      const prisma = buildPrismaMock();
      prisma.aiPricingConfig.findFirst.mockResolvedValue({ inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1, creditsPerUsd: 1000 });
      const service = buildService(prisma);

      await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 100, 100);
      await service.getCreditsForUsage('deepseek', DEEPSEEK_MODEL, 100, 100);

      expect(prisma.aiPricingConfig.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
