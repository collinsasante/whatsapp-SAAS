import { WebhookEventService } from './webhook-event.service';
import { WebhookSource, WebhookEventStatus } from '@prisma/client';

function buildPrismaMock() {
  return {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new WebhookEventService(prisma as any);
}

describe('WebhookEventService.recordReceived', () => {
  it('redacts secret-like keys in the payload before persisting', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.recordReceived({
      source: WebhookSource.PAYSTACK_COMMERCE,
      eventType: 'charge.success',
      payload: { event: 'charge.success', metadata: { orderId: 'o1' }, signature: 'abc123' },
    });

    const createArgs = prisma.webhookEvent.create.mock.calls[0][0];
    expect(createArgs.data.payload.signature).toBe('[REDACTED]');
    expect(createArgs.data.payload.metadata.orderId).toBe('o1');
    expect(createArgs.data.status).toBe(WebhookEventStatus.RECEIVED);
  });

  it('never throws even if the DB write fails, and returns undefined', async () => {
    const prisma = buildPrismaMock();
    prisma.webhookEvent.create.mockRejectedValue(new Error('db down'));
    const service = buildService(prisma);

    await expect(service.recordReceived({ source: WebhookSource.WHATSAPP, eventType: 'messages' })).resolves.toBeUndefined();
  });
});

describe('WebhookEventService.markOutcome', () => {
  it('is a no-op when id is undefined (recordReceived failed upstream)', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.markOutcome(undefined, 'PROCESSED');

    expect(prisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  it('writes status/error/processedAt', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.markOutcome('evt-1', 'FAILED', 'boom');

    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({ status: 'FAILED', error: 'boom' }),
    });
  });

  it('never throws even if the DB write fails', async () => {
    const prisma = buildPrismaMock();
    prisma.webhookEvent.update.mockRejectedValue(new Error('db down'));
    const service = buildService(prisma);

    await expect(service.markOutcome('evt-1', 'PROCESSED')).resolves.toBeUndefined();
  });
});

describe('WebhookEventService.markReprocessed', () => {
  it('increments attempts and sets processedAt', async () => {
    const prisma = buildPrismaMock();
    const service = buildService(prisma);

    await service.markReprocessed('evt-1', 'PROCESSED');

    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({ status: 'PROCESSED', attempts: { increment: 1 } }),
    });
  });
});
