import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';

function build(tenantExists = true) {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue(tenantExists ? { id: 't1' } : null) },
    tenantSettings: { upsert: jest.fn().mockImplementation(({ update }) => Promise.resolve({ aiDailyCreditCap: update.aiDailyCreditCap })) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = Object.create(PlatformAdminService.prototype) as any;
  service.prisma = prisma;
  return { service: service as PlatformAdminService, prisma };
}

describe('PlatformAdminService.setAiDailyCreditCap', () => {
  it.each([[0], [250], [null]])('stores %s', async (cap) => {
    const { service, prisma } = build();
    await expect(service.setAiDailyCreditCap('t1', cap)).resolves.toEqual({ success: true, tenantId: 't1', aiDailyCreditCap: cap });
    expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' }, create: { tenantId: 't1', aiDailyCreditCap: cap } }));
  });

  it.each([[-1], [1.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 2]])('rejects %s', async (cap) => {
    const { service, prisma } = build();
    await expect(service.setAiDailyCreditCap('t1', cap as number)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown workspace without writing', async () => {
    const { service, prisma } = build(false);
    await expect(service.setAiDailyCreditCap('missing', 10)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });
});
