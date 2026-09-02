import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';

function buildPrismaMock() {
  return {
    tenant: { findUnique: jest.fn() },
    tenantSettings: { upsert: jest.fn() },
  };
}

describe('PlatformAdminService.setCommerceConfig', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: PlatformAdminService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new PlatformAdminService(prisma as any);
  });

  it('upserts commerce settings for an existing workspace', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
    prisma.tenantSettings.upsert.mockResolvedValue({ commerceEnabled: true, takeRatePct: 5 });

    const result = await service.setCommerceConfig('t1', true, 5);

    expect(result).toEqual({ success: true, tenantId: 't1', commerceEnabled: true, takeRatePct: 5 });
    expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      create: { tenantId: 't1', commerceEnabled: true, takeRatePct: 5 },
      update: { commerceEnabled: true, takeRatePct: 5 },
      select: { commerceEnabled: true, takeRatePct: true },
    });
  });

  it('throws if the workspace does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(service.setCommerceConfig('missing', true, 5)).rejects.toThrow(NotFoundException);
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });

  it.each([-1, 100.1])('rejects an out-of-range take rate (%s)', async (pct) => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });

    await expect(service.setCommerceConfig('t1', true, pct)).rejects.toThrow(BadRequestException);
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });
});
