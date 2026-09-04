import { ErrorLogService } from './error-log.service';

function buildPrismaMock() {
  return {
    errorLog: {
      upsert: jest.fn().mockResolvedValue({ id: 'err-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({ id: 'err-1' }),
      update: jest.fn().mockResolvedValue({ id: 'err-1', status: 'RESOLVED' }),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ErrorLogService(prisma as any);
}

describe('ErrorLogService.record', () => {
  it('upserts on a stable fingerprint, incrementing occurrenceCount on repeat', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.record({ service: 'backend', message: 'DB connection refused', resourceType: 'http_route', resourceId: 'GET /x' });
    await service.record({ service: 'backend', message: 'DB connection refused', resourceType: 'http_route', resourceId: 'GET /x' });

    expect(prisma.errorLog.upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = prisma.errorLog.upsert.mock.calls;
    expect(firstCall[0].where.fingerprint).toBe(secondCall[0].where.fingerprint);
    expect(secondCall[0].update.occurrenceCount).toEqual({ increment: 1 });
  });

  it('produces different fingerprints for different services/resources', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.record({ service: 'backend', message: 'same message', resourceType: 'a' });
    await service.record({ service: 'frontend', message: 'same message', resourceType: 'a' });

    const [firstCall, secondCall] = prisma.errorLog.upsert.mock.calls;
    expect(firstCall[0].where.fingerprint).not.toBe(secondCall[0].where.fingerprint);
  });

  it('never throws even if the DB write fails', async () => {
    const prisma = buildPrismaMock();
    prisma.errorLog.upsert.mockRejectedValue(new Error('db down'));
    const service = buildService(prisma);

    await expect(service.record({ service: 'backend', message: 'x' })).resolves.toBeUndefined();
  });
});

describe('ErrorLogService.list/findOne/updateStatus', () => {
  it('applies filters and clamps limit to 100', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.list({ status: 'OPEN', severity: 'ERROR', tenantId: 't1', search: 'boom', limit: 500, offset: 10 });

    expect(prisma.errorLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'OPEN', severity: 'ERROR', tenantId: 't1', message: { contains: 'boom', mode: 'insensitive' } },
      take: 100,
      skip: 10,
    }));
  });

  it('findOne returns the row', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);
    await expect(service.findOne('err-1')).resolves.toEqual({ id: 'err-1' });
  });

  it('updateStatus writes the new status', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);
    await service.updateStatus('err-1', 'RESOLVED');
    expect(prisma.errorLog.update).toHaveBeenCalledWith({ where: { id: 'err-1' }, data: { status: 'RESOLVED' } });
  });
});
