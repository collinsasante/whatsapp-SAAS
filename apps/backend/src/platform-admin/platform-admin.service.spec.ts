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
    service = new PlatformAdminService(prisma as any, {} as any, {} as any, {} as any, {} as any);
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

describe('PlatformAdminService.updateAdminRole', () => {
  function buildAdminPrismaMock() {
    return {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue({ id: 'admin-2', role: 'VIEWER' }),
        update: jest.fn().mockResolvedValue({ id: 'admin-2', email: 'a2@x.com', name: 'A2', role: 'SUPPORT' }),
      },
    };
  }

  it('blocks an admin from changing their own role, even a SUPER_ADMIN', async () => {
    const prisma = buildAdminPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.updateAdminRole('admin-1', { role: 'SUPER_ADMIN' }, 'admin-1')).rejects.toThrow(BadRequestException);
    expect(prisma.platformAdmin.update).not.toHaveBeenCalled();
  });

  it('allows changing a different admin\'s role', async () => {
    const prisma = buildAdminPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    const result = await service.updateAdminRole('admin-2', { role: 'SUPPORT' }, 'admin-1');

    expect(result.role).toBe('SUPPORT');
    expect(prisma.platformAdmin.update).toHaveBeenCalledWith({
      where: { id: 'admin-2' },
      data: { role: 'SUPPORT' },
      select: { id: true, email: true, name: true, role: true },
    });
  });

  it('throws if the target admin does not exist', async () => {
    const prisma = buildAdminPrismaMock();
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.updateAdminRole('missing', { role: 'SUPPORT' }, 'admin-1')).rejects.toThrow(NotFoundException);
  });
});

describe('PlatformAdminService: errors & webhooks read paths', () => {
  it('delegates listErrors/getError to ErrorLogService', async () => {
    const errorLogService = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: 'err-1' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService({} as any, {} as any, {} as any, errorLogService as any, {} as any);

    await service.listErrors({ status: 'OPEN' });
    expect(errorLogService.list).toHaveBeenCalledWith({ status: 'OPEN' });

    const found = await service.getError('err-1');
    expect(found).toEqual({ id: 'err-1' });
  });

  it('getError throws NotFoundException for a missing id', async () => {
    const errorLogService = { findOne: jest.fn().mockResolvedValue(null) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService({} as any, {} as any, {} as any, errorLogService as any, {} as any);

    await expect(service.getError('missing')).rejects.toThrow(NotFoundException);
  });

  it('reprocessWebhookEvent delegates to CommerceLedgerService', async () => {
    const commerceLedgerService = { reprocessWebhookEvent: jest.fn().mockResolvedValue({ status: 'PROCESSED' }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new PlatformAdminService({} as any, {} as any, commerceLedgerService as any, {} as any, {} as any);

    const result = await service.reprocessWebhookEvent('evt-1');

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(commerceLedgerService.reprocessWebhookEvent).toHaveBeenCalledWith('evt-1');
  });
});
