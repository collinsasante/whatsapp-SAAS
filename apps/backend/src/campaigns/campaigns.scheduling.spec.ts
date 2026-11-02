import { BadRequestException } from '@nestjs/common';
import { CampaignsService, scheduledCampaignJobId } from './campaigns.service';
import { ScheduledCampaignProcessor } from './scheduled-campaign.processor';

/**
 * Scheduled campaigns end to end at the service and processor level: a launch with a future date queues exactly one delayed job, the
 * job starts the campaign when its time comes (only if it is still scheduled), cancellation removes it, retries are bounded, and the
 * last failure is visible on the campaign.
 */
function build(campaign: Record<string, unknown> | null = { id: 'c1', tenantId: 't1', status: 'DRAFT', scheduledAt: null }) {
  const campaignQueue = { add: jest.fn().mockResolvedValue({}) };
  const existingJob = { remove: jest.fn().mockResolvedValue(undefined) };
  const scheduledQueue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue(null) };
  const prisma = {
    campaign: {
      findFirst: jest.fn().mockResolvedValue(campaign),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    campaignRecipient: {
      findMany: jest.fn().mockResolvedValue(Array.from({ length: 120 }, (_v, i) => ({ id: `r${i}` }))),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    subscription: { findUnique: jest.fn() },
  };
  const service = new CampaignsService(prisma as never, campaignQueue as never, scheduledQueue as never);
  jest.spyOn(service, 'findOne').mockImplementation(async (tenantId: string, id: string) => {
    if (!campaign || campaign['tenantId'] !== tenantId || campaign['id'] !== id) throw new Error('Campaign not found');
    return campaign as never;
  });
  return { service, prisma, campaignQueue, scheduledQueue, existingJob };
}

const inTwoHours = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

describe('launching with a future date', () => {
  it('queues ONE delayed job with a stable id, bounded retries and the right delay, and marks the campaign SCHEDULED', async () => {
    const when = inTwoHours();
    const { service, scheduledQueue, campaignQueue, prisma } = build({ id: 'c1', tenantId: 't1', status: 'DRAFT', scheduledAt: when });
    await service.launch('t1', 'c1');

    expect(scheduledQueue.add).toHaveBeenCalledTimes(1);
    const [name, data, options] = scheduledQueue.add.mock.calls[0];
    expect(name).toBe('launch-campaign');
    expect(data).toEqual({ campaignId: 'c1', tenantId: 't1' });
    expect(options).toMatchObject({ jobId: scheduledCampaignJobId('c1'), attempts: 3, backoff: { type: 'exponential' }, removeOnComplete: true });
    expect(Math.abs(options.delay - (when.getTime() - Date.now()))).toBeLessThan(2000);
    expect(prisma.campaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'SCHEDULED' } });
    expect(campaignQueue.add).not.toHaveBeenCalled(); // nothing is sent now
  });

  it('launching twice does not double the job: an earlier job for this campaign is replaced, never duplicated', async () => {
    const { service, scheduledQueue, existingJob } = build({ id: 'c1', tenantId: 't1', status: 'SCHEDULED', scheduledAt: inTwoHours() });
    scheduledQueue.getJob.mockResolvedValue(existingJob);
    await service.launch('t1', 'c1');
    expect(scheduledQueue.getJob).toHaveBeenCalledWith(scheduledCampaignJobId('c1'));
    expect(existingJob.remove).toHaveBeenCalledTimes(1);
    expect(scheduledQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a date in the past (or none) starts sending immediately and queues no delayed job', async () => {
    for (const scheduledAt of [new Date(Date.now() - 1000), null]) {
      const { service, scheduledQueue, campaignQueue } = build({ id: 'c1', tenantId: 't1', status: 'DRAFT', scheduledAt });
      await expect(service.launch('t1', 'c1')).resolves.toMatchObject({ message: 'Campaign launched', batches: 3 });
      expect(scheduledQueue.add).not.toHaveBeenCalled();
      expect(campaignQueue.add).toHaveBeenCalledTimes(3); // 120 recipients in batches of 50
    }
  });

  it.each(['RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'])('a %s campaign cannot be launched', async (status) => {
    const { service, scheduledQueue } = build({ id: 'c1', tenantId: 't1', status, scheduledAt: inTwoHours() });
    await expect(service.launch('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(scheduledQueue.add).not.toHaveBeenCalled();
  });

  it("another workspace cannot launch this one's campaign", async () => {
    const { service, scheduledQueue } = build({ id: 'c1', tenantId: 't1', status: 'DRAFT', scheduledAt: inTwoHours() });
    await expect(service.launch('t-other', 'c1')).rejects.toThrow('Campaign not found');
    expect(scheduledQueue.add).not.toHaveBeenCalled();
  });
});

describe('the scheduled time arrives (startScheduled)', () => {
  it('claims the campaign with one conditional write scoped to the workspace, then queues the real send batches', async () => {
    const { service, prisma, campaignQueue } = build();
    await expect(service.startScheduled('t1', 'c1')).resolves.toEqual({ started: true, batches: 3 });
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId: 't1', status: 'SCHEDULED' },
      data: { status: 'RUNNING', startedAt: expect.any(Date) },
    });
    expect(campaignQueue.add).toHaveBeenCalledTimes(3);
    const [name, data, options] = campaignQueue.add.mock.calls[1];
    expect(name).toBe('send-batch');
    expect(data).toMatchObject({ campaignId: 'c1', tenantId: 't1', batchIndex: 1 });
    expect(options).toMatchObject({ delay: 2000, attempts: 3, backoff: { type: 'exponential' } });
  });

  it.each([
    ['deleted', 0],
    ['already started', 0],
    ['paused or changed', 0],
  ])('does nothing when the campaign is %s (the claim matches no row)', async (_label, count) => {
    const { service, prisma, campaignQueue } = build();
    prisma.campaign.updateMany.mockResolvedValue({ count });
    await expect(service.startScheduled('t1', 'c1')).resolves.toMatchObject({ started: false });
    expect(campaignQueue.add).not.toHaveBeenCalled();
  });

  it('a second delivery of the same job cannot send twice: only the first claim succeeds', async () => {
    const { service, prisma, campaignQueue } = build();
    prisma.campaign.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await service.startScheduled('t1', 'c1');
    await service.startScheduled('t1', 'c1');
    expect(campaignQueue.add).toHaveBeenCalledTimes(3); // one campaign's batches, once
  });

  it('never starts a campaign of another workspace: the claim is scoped by tenantId', async () => {
    const { service, prisma } = build();
    prisma.campaign.updateMany.mockResolvedValue({ count: 0 });
    await service.startScheduled('t-other', 'c1');
    expect(prisma.campaign.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'c1', tenantId: 't-other', status: 'SCHEDULED' });
  });

  it('when queueing the batches fails the campaign goes back to SCHEDULED and the error is rethrown so the job is retried', async () => {
    const { service, prisma, campaignQueue } = build();
    campaignQueue.add.mockRejectedValue(new Error('redis down'));
    await expect(service.startScheduled('t1', 'c1')).rejects.toThrow('redis down');
    expect(prisma.campaign.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'c1', tenantId: 't1', status: 'RUNNING' },
      data: { status: 'SCHEDULED', startedAt: null },
    });
  });

  it('the last failed attempt marks the campaign FAILED, only if it is still scheduled', async () => {
    const { service, prisma } = build();
    await service.markScheduledLaunchFailed('t1', 'c1');
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1', status: 'SCHEDULED' }, data: { status: 'FAILED' } });
  });
});

describe('cancellation', () => {
  it('deleting a scheduled campaign removes its delayed job and its recipients', async () => {
    const { service, scheduledQueue, existingJob, prisma } = build({ id: 'c1', tenantId: 't1', status: 'SCHEDULED', scheduledAt: inTwoHours() });
    scheduledQueue.getJob.mockResolvedValue(existingJob);
    await expect(service.delete('t1', 'c1')).resolves.toEqual({ deleted: true });
    expect(existingJob.remove).toHaveBeenCalledTimes(1);
    expect(prisma.campaignRecipient.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'c1' } });
    expect(prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('a job that cannot be removed does not block the deletion, and the processor still skips a campaign that no longer exists', async () => {
    const { service, scheduledQueue, existingJob, prisma } = build({ id: 'c1', tenantId: 't1', status: 'SCHEDULED', scheduledAt: inTwoHours() });
    existingJob.remove.mockRejectedValue(new Error('job is locked'));
    scheduledQueue.getJob.mockResolvedValue(existingJob);
    await expect(service.delete('t1', 'c1')).resolves.toEqual({ deleted: true });
    prisma.campaign.updateMany.mockResolvedValue({ count: 0 }); // the row is gone when the job fires
    await expect(service.startScheduled('t1', 'c1')).resolves.toMatchObject({ started: false });
  });

  it('a running campaign cannot be deleted, and its job is left alone', async () => {
    const { service, scheduledQueue } = build({ id: 'c1', tenantId: 't1', status: 'RUNNING' });
    await expect(service.delete('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(scheduledQueue.getJob).not.toHaveBeenCalled();
  });
});

describe('ScheduledCampaignProcessor', () => {
  function processor(started = true) {
    const campaigns = {
      startScheduled: jest.fn().mockResolvedValue(started ? { started: true, batches: 3 } : { started: false, reason: 'not scheduled' }),
      markScheduledLaunchFailed: jest.fn().mockResolvedValue(undefined),
    };
    return { processor: new ScheduledCampaignProcessor(campaigns as never), campaigns };
  }
  const job = (data: unknown, attemptsMade = 1, attempts = 3) => ({ data, attemptsMade, opts: { attempts } }) as never;

  it('starts the campaign named by a valid job, for the job\'s workspace', async () => {
    const { processor: p, campaigns } = processor();
    await p.process(job({ campaignId: 'c1', tenantId: 't1' }));
    expect(campaigns.startScheduled).toHaveBeenCalledWith('t1', 'c1');
  });

  it.each([
    ['no data', undefined],
    ['no campaign id', { tenantId: 't1' }],
    ['no tenant id', { campaignId: 'c1' }],
    ['non-string ids', { campaignId: 5, tenantId: {} }],
    ['empty ids', { campaignId: '', tenantId: '' }],
  ])('drops a malformed job (%s) without starting anything', async (_label, data) => {
    const { processor: p, campaigns } = processor();
    await expect(p.process(job(data))).resolves.toBeUndefined();
    expect(campaigns.startScheduled).not.toHaveBeenCalled();
  });

  it('a campaign that is no longer scheduled completes quietly (no retry)', async () => {
    const { processor: p } = processor(false);
    await expect(p.process(job({ campaignId: 'c1', tenantId: 't1' }))).resolves.toBeUndefined();
  });

  it('propagates a start failure so the queue retries it', async () => {
    const { processor: p, campaigns } = processor();
    campaigns.startScheduled.mockRejectedValue(new Error('redis down'));
    await expect(p.process(job({ campaignId: 'c1', tenantId: 't1' }))).rejects.toThrow('redis down');
  });

  it('marks the campaign FAILED only after the final attempt', async () => {
    const { processor: p, campaigns } = processor();
    await p.onFailed(job({ campaignId: 'c1', tenantId: 't1' }, 1, 3), new Error('x'));
    await p.onFailed(job({ campaignId: 'c1', tenantId: 't1' }, 2, 3), new Error('x'));
    expect(campaigns.markScheduledLaunchFailed).not.toHaveBeenCalled();
    await p.onFailed(job({ campaignId: 'c1', tenantId: 't1' }, 3, 3), new Error('x'));
    expect(campaigns.markScheduledLaunchFailed).toHaveBeenCalledWith('t1', 'c1');
  });

  it('ignores a failure event with no usable job', async () => {
    const { processor: p, campaigns } = processor();
    await p.onFailed(undefined, new Error('x'));
    await p.onFailed(job({}), new Error('x'));
    expect(campaigns.markScheduledLaunchFailed).not.toHaveBeenCalled();
  });
});
