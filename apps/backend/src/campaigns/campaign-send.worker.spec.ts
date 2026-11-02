import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { CampaignSendWorker } from '../../../worker/src/processors/campaign-send.processor';
// The worker app has no test runner of its own, so its send processor is exercised from here. This is the SAME axios instance the
// worker module imports (resolved from the worker's own dependencies), so spying on it intercepts the worker's Meta calls.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const workerAxios = require('../../../worker/node_modules/axios').default ?? require('../../../worker/node_modules/axios');

/**
 * The campaign SEND side (what the scheduled launch queues): delivery tracking per recipient, bounded failure handling, retry
 * safety, workspace scoping, and completion. No call ever reaches Meta: the Graph API call is intercepted.
 */
type Recipient = { id: string; contactId: string; status?: string; contact: { phone: string; isBlocked?: boolean; optedOut?: boolean } };

function build(opts: { campaign?: Record<string, unknown> | null; recipients?: Recipient[]; pendingAfter?: number; tenant?: Record<string, unknown> | null; counters?: { status?: string; sentCount: number; failedCount: number } | null } = {}) {
  const campaign = opts.campaign === null ? null : {
    id: 'c1', tenantId: 't1', status: 'RUNNING', whatsappNumberId: null, templateId: 'tpl1', templateVariables: {}, trackingUrl: null,
    template: { name: 'promo', language: 'en', components: [] }, ...opts.campaign,
  };
  const recipients = opts.recipients ?? [{ id: 'r1', contactId: 'k1', contact: { phone: '+233555000111' } }];
  const prisma = {
    campaign: {
      findFirst: jest.fn().mockResolvedValue(campaign),
      findUnique: jest.fn().mockResolvedValue(opts.counters === null ? null : { status: 'RUNNING', sentCount: 1, failedCount: 0, ...opts.counters }),
      update: jest.fn().mockResolvedValue({}),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue(opts.tenant === undefined ? { phoneNumberId: 'pn1', accessToken: 'token-not-real' } : opts.tenant) },
    whatsAppNumber: { findFirst: jest.fn().mockResolvedValue(null) },
    campaignRecipient: {
      findMany: jest.fn().mockResolvedValue(recipients),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: recipients.length }),
      count: jest.fn().mockResolvedValue(opts.pendingAfter ?? 0),
    },
    campaignClick: { create: jest.fn().mockResolvedValue({}) },
    message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv1', whatsappNumberId: null }), create: jest.fn(), update: jest.fn() },
  };
  const worker = new CampaignSendWorker(prisma as never, { host: 'localhost', port: 6379 });
  jest.spyOn(worker as never, 'sleep' as never).mockResolvedValue(undefined as never);
  const run = (data: Record<string, unknown> = { campaignId: 'c1', tenantId: 't1', recipientIds: recipients.map((r) => r.id), batchIndex: 0 }) =>
    (worker as unknown as { process: (job: unknown) => Promise<void> }).process({ data });
  return { prisma, run };
}

const recipientUpdates = (prisma: ReturnType<typeof build>['prisma']) => prisma.campaignRecipient.update.mock.calls.map((c: unknown[]) => c[0] as { where: { id: string }; data: Record<string, unknown> });
const counterUpdates = (prisma: ReturnType<typeof build>['prisma']) => prisma.campaign.update.mock.calls.map((c: unknown[]) => (c[0] as { data: Record<string, unknown> }).data);

describe('CampaignSendWorker', () => {
  let post: jest.SpyInstance;
  beforeEach(() => { post = jest.spyOn(workerAxios, 'post').mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } }); });
  afterEach(() => post.mockRestore());

  describe('delivery tracking', () => {
    it('sends the template, stores the message, marks the recipient SENT and counts it', async () => {
      const { prisma, run } = build();
      await run();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toMatch(/\/pn1\/messages$/);
      expect(post.mock.calls[0][1]).toMatchObject({ messaging_product: 'whatsapp', to: '+233555000111', type: 'template', template: { name: 'promo', language: { code: 'en' } } });
      expect(prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 't1', whatsappMessageId: 'wamid.1', type: 'TEMPLATE', direction: 'OUTBOUND', status: 'SENT' }) });
      expect(recipientUpdates(prisma)).toEqual([{ where: { id: 'r1' }, data: expect.objectContaining({ status: 'SENT', messageId: 'm1' }) }]);
      expect(counterUpdates(prisma)).toContainEqual({ sentCount: { increment: 1 } });
    });

    it('a Meta rejection fails only that recipient, records why and the Meta error code, and the batch carries on', async () => {
      const metaError = Object.assign(new Error('Request failed with status code 400'), { isAxiosError: true, response: { data: { error: { code: 131026, message: 'Message undeliverable' } } } });
      post.mockRejectedValueOnce(metaError);
      const { prisma, run } = build({ recipients: [
        { id: 'r1', contactId: 'k1', contact: { phone: '+233555000111' } },
        { id: 'r2', contactId: 'k2', contact: { phone: '+233555000222' } },
      ] });
      await run();
      expect(post).toHaveBeenCalledTimes(2);
      const updates = recipientUpdates(prisma);
      expect(updates[0]).toEqual({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'FAILED', errorCode: 131026 }) });
      expect(updates[1]).toEqual({ where: { id: 'r2' }, data: expect.objectContaining({ status: 'SENT' }) });
      expect(counterUpdates(prisma)).toEqual(expect.arrayContaining([{ failedCount: { increment: 1 } }, { sentCount: { increment: 1 } }]));
    });

    it.each([
      ['blocked', { isBlocked: true }],
      ['opted out', { optedOut: true }],
    ])('a %s contact is never messaged: FAILED with the reason, no Meta call', async (_label, flags) => {
      const { prisma, run } = build({ recipients: [{ id: 'r1', contactId: 'k1', contact: { phone: '+233555000111', ...flags } }] });
      await run();
      expect(post).not.toHaveBeenCalled();
      expect(recipientUpdates(prisma)[0].data).toMatchObject({ status: 'FAILED', errorMessage: 'Contact blocked or opted out' });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('a simulated test number never reaches Meta', async () => {
      const { prisma, run } = build({ recipients: [{ id: 'r1', contactId: 'k1', contact: { phone: simulatedPhoneFor('review') } }] });
      await run();
      expect(post).not.toHaveBeenCalled();
      expect(recipientUpdates(prisma)[0].data).toMatchObject({ status: 'FAILED' });
    });
  });

  describe('retry safety and scoping', () => {
    it('only still-PENDING recipients of this batch are read, so a retried job cannot message anyone twice', async () => {
      const { prisma, run } = build();
      await run();
      expect(prisma.campaignRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['r1'] }, campaignId: 'c1', status: 'PENDING' } }));
    });

    it('the campaign is read inside the job\'s own workspace, so a job for another workspace finds nothing and sends nothing', async () => {
      const { prisma, run } = build({ campaign: null });
      await run({ campaignId: 'c1', tenantId: 't-other', recipientIds: ['r1'], batchIndex: 0 });
      expect(prisma.campaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 't-other' } }));
      expect(post).not.toHaveBeenCalled();
      expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
    });

    it.each(['PAUSED', 'COMPLETED', 'FAILED', 'DRAFT', 'SCHEDULED'])('a %s campaign sends nothing and touches no recipient', async (status) => {
      const { prisma, run } = build({ campaign: { status } });
      await run();
      expect(post).not.toHaveBeenCalled();
      expect(prisma.campaignRecipient.findMany).not.toHaveBeenCalled();
      expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
      expect(prisma.campaignRecipient.updateMany).not.toHaveBeenCalled();
    });

    it('missing WhatsApp credentials are permanent: nothing is sent, the batch is closed out as FAILED with a reason, and the job does not loop', async () => {
      const { prisma, run } = build({ tenant: null, counters: { sentCount: 0, failedCount: 1 } });
      await expect(run()).resolves.toBeUndefined();
      expect(post).not.toHaveBeenCalled();
      expect(prisma.campaignRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r1'] }, campaignId: 'c1', status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: expect.stringContaining('not configured') },
      });
      expect(counterUpdates(prisma)).toContainEqual({ failedCount: { increment: 1 } });
      expect(counterUpdates(prisma)).toContainEqual({ status: 'FAILED', completedAt: expect.any(Date) });
    });
  });

  describe('pause inside a running batch', () => {
    it('stops before the next recipient once the campaign is no longer RUNNING, leaving the rest PENDING', async () => {
      const { prisma, run } = build({ recipients: [
        { id: 'r1', contactId: 'k1', contact: { phone: '+233555000111' } },
        { id: 'r2', contactId: 'k2', contact: { phone: '+233555000222' } },
      ] });
      prisma.campaign.findUnique
        .mockResolvedValueOnce({ status: 'RUNNING' })
        .mockResolvedValueOnce({ status: 'PAUSED' });
      await run();
      expect(post).toHaveBeenCalledTimes(1);
      expect(prisma.campaignRecipient.update.mock.calls.map((c: unknown[]) => (c[0] as { where: { id: string } }).where.id)).toEqual(['r1']);
    });
  });

  describe('retries are bounded and always end in a terminal outcome', () => {
    const failBatch = (worker: unknown, data: Record<string, unknown>, reason: string) => (worker as { failBatch: (d: unknown, r: string) => Promise<void> }).failBatch(data, reason);

    it('after the last attempt the still-PENDING recipients of the batch become FAILED (SENT ones are never touched) and the campaign settles', async () => {
      const { prisma } = build({ counters: { sentCount: 0, failedCount: 3 } });
      const worker = new CampaignSendWorker(prisma as never, { host: 'localhost', port: 6379 });
      await failBatch(worker, { campaignId: 'c1', tenantId: 't1', recipientIds: ['r1', 'r2', 'r3'] }, 'Sending failed after 3 attempts: boom');
      expect(prisma.campaignRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['r1', 'r2', 'r3'] }, campaignId: 'c1', status: 'PENDING' } }));
      expect(counterUpdates(prisma)).toContainEqual({ status: 'FAILED', completedAt: expect.any(Date) });
    });

    it('closing out a batch for a campaign of another workspace changes nothing', async () => {
      const { prisma } = build({ campaign: null });
      const worker = new CampaignSendWorker(prisma as never, { host: 'localhost', port: 6379 });
      await failBatch(worker, { campaignId: 'c1', tenantId: 't-other', recipientIds: ['r1'] }, 'x');
      expect(prisma.campaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 't-other' } }));
      expect(prisma.campaignRecipient.updateMany).not.toHaveBeenCalled();
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('a paused campaign is not settled even when nobody is pending', async () => {
      const { prisma } = build({ counters: { status: 'PAUSED', sentCount: 1, failedCount: 0 } });
      const worker = new CampaignSendWorker(prisma as never, { host: 'localhost', port: 6379 });
      await failBatch(worker, { campaignId: 'c1', tenantId: 't1', recipientIds: ['r1'] }, 'x');
      expect(counterUpdates(prisma).some((d) => d['status'])).toBe(false);
    });
  });

  describe('completion', () => {
    it('marks the campaign COMPLETED once nobody is left PENDING and something was sent', async () => {
      const { prisma, run } = build({ pendingAfter: 0, counters: { sentCount: 1, failedCount: 0 } });
      await run();
      expect(counterUpdates(prisma)).toContainEqual({ status: 'COMPLETED', completedAt: expect.any(Date) });
    });

    it('a partly failed campaign is COMPLETED with failedCount recording the failures (partial completion)', async () => {
      const { prisma, run } = build({ pendingAfter: 0, counters: { sentCount: 5, failedCount: 2 } });
      await run();
      expect(counterUpdates(prisma)).toContainEqual({ status: 'COMPLETED', completedAt: expect.any(Date) });
    });

    it('a campaign where nothing could be sent is FAILED, not COMPLETED', async () => {
      const { prisma, run } = build({ pendingAfter: 0, counters: { sentCount: 0, failedCount: 4 } });
      await run();
      expect(counterUpdates(prisma)).toContainEqual({ status: 'FAILED', completedAt: expect.any(Date) });
    });

    it('stays RUNNING while recipients are still waiting in other batches', async () => {
      const { prisma, run } = build({ pendingAfter: 70 });
      await run();
      expect(counterUpdates(prisma).some((d) => d['status'] === 'COMPLETED' || d['status'] === 'FAILED')).toBe(false);
    });
  });
});
