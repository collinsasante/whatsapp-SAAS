import { PlatformHealthService } from './platform-health.service';

function buildQueueStub() {
  return { getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }) };
}

function buildService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    whatsAppNumber: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsDailyMessageStats: { groupBy: jest.fn().mockResolvedValue([]) },
    conversation: { groupBy: jest.fn().mockResolvedValue([]) },
    payment: { groupBy: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
    aiExecution: { findFirst: jest.fn().mockResolvedValue(null) },
    ...prismaOverrides,
  };
  const q = buildQueueStub();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new PlatformHealthService(prisma as any, q as any, q as any, q as any, q as any, q as any, q as any, q as any, q as any, q as any, q as any, q as any);
  return { service, prisma };
}

describe('PlatformHealthService.getPlatformHealth -- new real pings', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('reports a real DB ping with latency on success', async () => {
    const { service } = buildService();
    const health = await service.getPlatformHealth();
    expect(health.dbPing.reachable).toBe(true);
    expect(typeof health.dbPing.latencyMs).toBe('number');
  });

  it('reports the DB as unreachable (not a crash) when the query fails', async () => {
    const { service } = buildService({ $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) });
    const health = await service.getPlatformHealth();
    expect(health.dbPing).toEqual({ reachable: false, latencyMs: null });
  });

  it('AI provider health reflects real config + real last-success data, not a fabricated status', async () => {
    delete process.env['DEEPSEEK_API_KEY'];
    const { service, prisma } = buildService();
    prisma.aiExecution.findFirst.mockResolvedValue({ createdAt: new Date('2026-09-01T00:00:00Z'), provider: 'deepseek' });

    const health = await service.getPlatformHealth();

    expect(health.aiProvider).toEqual({ configured: false, lastSuccessfulCallAt: '2026-09-01T00:00:00.000Z', provider: 'deepseek' });
  });

  it('payment gateway health reflects real config + real last-success data', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_x';
    delete process.env['PAYSTACK_SECRET_KEY'];
    const { service, prisma } = buildService();
    prisma.payment.findFirst.mockResolvedValue({ createdAt: new Date('2026-09-02T00:00:00Z'), gateway: 'STRIPE' });

    const health = await service.getPlatformHealth();

    expect(health.paymentGateway).toEqual({
      stripeConfigured: true, paystackConfigured: false,
      lastSuccessfulPaymentAt: '2026-09-02T00:00:00.000Z', gateway: 'STRIPE',
    });
  });

  it('reports null values (not fabricated) when nothing has ever succeeded', async () => {
    const { service } = buildService();
    const health = await service.getPlatformHealth();
    expect(health.aiProvider.lastSuccessfulCallAt).toBeNull();
    expect(health.paymentGateway.lastSuccessfulPaymentAt).toBeNull();
  });
});
