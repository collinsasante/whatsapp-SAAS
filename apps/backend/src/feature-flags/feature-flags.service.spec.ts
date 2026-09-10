import { FeatureFlagsService } from './feature-flags.service';

function buildPrismaMock() {
  return { featureFlag: { findUnique: jest.fn() } };
}

describe('FeatureFlagsService.isEnabledCached', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: FeatureFlagsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new FeatureFlagsService(prisma as any);
  });

  it('queries the DB on the first call and caches the result', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ key: 'verz_ai_v2', enabled: true, killSwitch: false, rolloutType: 'all', rolloutPct: 0, betaTenants: [] });

    const first = await service.isEnabledCached('verz_ai_v2', 'tenant-1');
    const second = await service.isEnabledCached('verz_ai_v2', 'tenant-1');

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(prisma.featureFlag.findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches per tenant -- a different tenantId is a cache miss', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({
      key: 'verz_ai_v2', enabled: true, killSwitch: false, rolloutType: 'tenants', rolloutPct: 0, betaTenants: ['tenant-1'],
    });

    const forTenant1 = await service.isEnabledCached('verz_ai_v2', 'tenant-1');
    const forTenant2 = await service.isEnabledCached('verz_ai_v2', 'tenant-2');

    expect(forTenant1).toBe(true);
    expect(forTenant2).toBe(false);
    expect(prisma.featureFlag.findUnique).toHaveBeenCalledTimes(2);
  });

  it('returns false for a nonexistent flag without throwing', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue(null);

    await expect(service.isEnabledCached('nonexistent_flag', 'tenant-1')).resolves.toBe(false);
  });
});
