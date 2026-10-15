import { WebhookEventsService } from './webhook-events.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(opts: { webhooks?: { id: string }[]; message?: Record<string, unknown> | null } = {}) {
  const conversation = {
    id: 'conv-1',
    status: 'OPEN',
    channel: { id: 'ch-1', type: 'WHATSAPP', name: 'WhatsApp' },
    assignedTo: { id: 'u-1', name: 'Ama', email: 'ama@example.com' },
    contact: { id: 'contact-1', phone: '233241234567', name: 'Kofi', email: null },
  };
  const prisma = {
    webhook: { findMany: jest.fn().mockResolvedValue(opts.webhooks ?? [{ id: 'wh-1' }, { id: 'wh-2' }]) },
    message: {
      findFirst: jest.fn().mockResolvedValue(
        opts.message === undefined
          ? { id: 'msg-1', type: 'TEXT', direction: 'INBOUND', content: 'Hello', conversation }
          : opts.message,
      ),
    },
    conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new WebhookEventsService(prisma as never, queue as never);
  return { service, prisma, queue };
}

describe('WebhookEventsService', () => {
  it('fires message.received for inbound messages, one delivery per subscribed webhook', async () => {
    const { service, prisma, queue } = setup();
    service.messageCreated('tenant-1', 'msg-1', 'INBOUND', 'DELIVERED');
    await flush();

    expect(prisma.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1', isActive: true }) }),
    );
    expect(queue.add).toHaveBeenCalledTimes(2);
    const [name, job, options] = queue.add.mock.calls[0];
    expect(name).toBe('message.received');
    expect(job).toMatchObject({
      webhookId: 'wh-1',
      tenantId: 'tenant-1',
      event: 'message.received',
      data: {
        message: { id: 'msg-1', content: 'Hello' },
        conversation: { id: 'conv-1', assignedTo: { email: 'ama@example.com' } },
        contact: { id: 'contact-1', phone: '233241234567' },
      },
    });
    expect(options).toMatchObject({ jobId: job.deliveryId, attempts: 5 });
    expect(queue.add.mock.calls[1][1].deliveryId).not.toBe(job.deliveryId);
  });

  it('maps outbound messages and delivery receipts to the advertised event names', async () => {
    const { service, queue } = setup();
    service.messageCreated('t', 'm', 'OUTBOUND', 'SENT');
    service.messageCreated('t', 'm', 'OUTBOUND', 'FAILED');
    service.messageStatusChanged('t', 'm', 'DELIVERED');
    service.messageStatusChanged('t', 'm', 'READ');
    service.messageStatusChanged('t', 'm', 'FAILED');
    service.messageStatusChanged('t', 'm', 'SENT'); // already covered by message.sent
    await flush();
    const events = queue.add.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === 'message.sent')).toHaveLength(2);
    expect(new Set(events)).toEqual(new Set(['message.sent', 'message.failed', 'message.delivered', 'message.read']));
  });

  it('never sends internal notes', async () => {
    const { service, queue } = setup({ message: { id: 'n', type: 'NOTE', conversation: {} } });
    service.messageCreated('t', 'n', 'OUTBOUND', 'SENT');
    await flush();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does no message lookup when nobody subscribed', async () => {
    const { service, prisma, queue } = setup({ webhooks: [] });
    service.messageCreated('t', 'm', 'INBOUND');
    await flush();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('only looks up messages within the tenant', async () => {
    const { service, prisma } = setup();
    service.messageCreated('tenant-9', 'msg-1', 'INBOUND');
    await flush();
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg-1', tenantId: 'tenant-9' } }),
    );
  });

  it('fires conversation.assigned with the conversation and contact', async () => {
    const { service, queue } = setup();
    service.conversationAssigned('t', 'conv-1');
    await flush();
    expect(queue.add.mock.calls[0][1]).toMatchObject({
      event: 'conversation.assigned',
      data: { conversation: { id: 'conv-1' }, contact: { id: 'contact-1' } },
    });
  });

  it('swallows failures so messaging is never affected', async () => {
    const { service, queue } = setup();
    queue.add.mockRejectedValue(new Error('redis down'));
    expect(() => service.messageCreated('t', 'm', 'INBOUND')).not.toThrow();
    await flush();
  });
});
