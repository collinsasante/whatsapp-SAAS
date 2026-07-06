import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { buildPaginationMeta, getPaginationSkip, normalizePhone } from '@whatsapp-platform/shared-utils';
import { QueueName } from '@whatsapp-platform/shared-types';
import { CampaignStatus } from '@whatsapp-platform/shared-types';
import { buildContactWhere, SegmentFilter } from '../segments/segments.service';

const BATCH_SIZE = 50;

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(QueueName.CAMPAIGN_SEND) private campaignQueue: Queue,
    @InjectQueue(QueueName.SCHEDULED_CAMPAIGN) private scheduledQueue: Queue,
  ) {}

  async create(tenantId: string, createdById: string, dto: CreateCampaignDto) {
    // Enforce plan limit: campaigns
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (sub?.plan.limMaxCampaigns === 0) {
      throw new ForbiddenException('Your current plan does not include campaigns. Upgrade to create campaigns.');
    }

    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, tenantId, status: 'APPROVED' },
    });
    if (!template) throw new BadRequestException('Template not found or not approved');

    let contactIds = dto.contactIds ?? [];

    if (dto.apiOnly) {
      // API campaigns have no pre-built recipient list — messages are sent one-by-one via the send API
    } else {
    // Segment targeting
    if (dto.segmentId && !contactIds.length) {
      const segment = await this.prisma.contactSegment.findFirst({ where: { id: dto.segmentId, tenantId } });
      if (segment) {
        const filters = segment.filters as unknown as SegmentFilter[];
        const where = { ...buildContactWhere(tenantId, filters), isBlocked: false, optedOut: false };
        const contacts = await this.prisma.contact.findMany({ where, select: { id: true } });
        contactIds = contacts.map((c) => c.id);
      }
    }

    // Label targeting
    if (dto.labels?.length && !contactIds.length) {
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, labels: { hasSome: dto.labels }, isBlocked: false, optedOut: false },
        select: { id: true },
      });
      contactIds = contacts.map((c) => c.id);
    }

    // Phone list targeting (CSV upload)
    if (dto.phones?.length && !contactIds.length) {
      const normalizedPhones = dto.phones.map(normalizePhone);
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, phone: { in: normalizedPhones }, isBlocked: false, optedOut: false },
        select: { id: true },
      });
      contactIds = contacts.map((c) => c.id);
    }

    // Default: all opted-in, non-blocked contacts
    if (!contactIds.length && !dto.segmentId && !dto.labels?.length && !dto.phones?.length && !dto.contactIds?.length) {
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, isBlocked: false, optedOut: false },
        select: { id: true },
      });
      contactIds = contacts.map((c) => c.id);
    }
    } // end of !apiOnly block

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        createdById,
        name: dto.name,
        templateId: dto.templateId,
        templateVariables: dto.templateVariables ?? undefined,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        trackingUrl: dto.trackingUrl ?? undefined,
        totalRecipients: contactIds.length,
        status: dto.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
      },
    });

    if (contactIds.length) {
      const recipientData = contactIds.map((contactId) => ({
        campaignId: campaign.id,
        contactId,
      }));
      await this.prisma.campaignRecipient.createMany({ data: recipientData });
    }

    return campaign;
  }

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = getPaginationSkip(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { template: { select: { name: true, language: true, category: true } } },
      }),
      this.prisma.campaign.count({ where: { tenantId } }),
    ]);

    // Compute real delivery counts from CampaignRecipient statuses (covers campaigns
    // that ran before the counter columns were wired up).
    const campaignIds = data.map((c) => c.id);
    const [recipientStats, replyStats] = campaignIds.length
      ? await Promise.all([
          this.prisma.campaignRecipient.groupBy({
            by: ['campaignId', 'status'],
            where: { campaignId: { in: campaignIds } },
            _count: { id: true },
          }),
          this.prisma.campaignRecipient.groupBy({
            by: ['campaignId'],
            where: { campaignId: { in: campaignIds }, repliedAt: { not: null } },
            _count: { id: true },
          }),
        ])
      : [[], []];

    const statsMap = new Map<string, Record<string, number>>();
    for (const row of recipientStats) {
      const m = statsMap.get(row.campaignId) ?? {};
      m[row.status] = row._count.id;
      statsMap.set(row.campaignId, m);
    }
    const repliedMap = new Map<string, number>();
    for (const row of replyStats) repliedMap.set(row.campaignId, row._count.id);

    const dataWithCounts = data.map((c) => {
      const s = statsMap.get(c.id) ?? {};
      const sent      = (s['SENT'] ?? 0) + (s['DELIVERED'] ?? 0) + (s['READ'] ?? 0);
      const delivered = (s['DELIVERED'] ?? 0) + (s['READ'] ?? 0);
      const read      = s['READ'] ?? 0;
      const failed    = s['FAILED'] ?? 0;
      const replied   = repliedMap.get(c.id) ?? 0;
      return {
        ...c,
        sentCount:      Math.max(c.sentCount, sent),
        deliveredCount: Math.max(c.deliveredCount, delivered),
        readCount:      Math.max(c.readCount, read),
        failedCount:    Math.max(c.failedCount, failed),
        repliedCount:   Math.max(c.repliedCount, replied),
      };
    });

    return { data: dataWithCounts, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const [campaign, recipientStats, repliedCountReal] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id, tenantId },
        include: {
          template: true,
          _count: { select: { recipients: true } },
        },
      }),
      this.prisma.campaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId: id },
        _count: { id: true },
      }),
      this.prisma.campaignRecipient.count({ where: { campaignId: id, repliedAt: { not: null } } }),
    ]);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const s: Record<string, number> = {};
    for (const row of recipientStats) s[row.status] = row._count.id;
    const sent      = (s['SENT'] ?? 0) + (s['DELIVERED'] ?? 0) + (s['READ'] ?? 0);
    const delivered = (s['DELIVERED'] ?? 0) + (s['READ'] ?? 0);
    const read      = s['READ'] ?? 0;
    const failed    = s['FAILED'] ?? 0;

    return {
      ...campaign,
      sentCount:      Math.max(campaign.sentCount, sent),
      deliveredCount: Math.max(campaign.deliveredCount, delivered),
      readCount:      Math.max(campaign.readCount, read),
      failedCount:    Math.max(campaign.failedCount, failed),
      repliedCount:   Math.max(campaign.repliedCount, repliedCountReal),
    };
  }

  async update(tenantId: string, id: string, dto: UpdateCampaignDto) {
    const campaign = await this.findOne(tenantId, id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be updated');
    }
    return this.prisma.campaign.update({ where: { id }, data: dto });
  }

  async launch(tenantId: string, campaignId: string) {
    const campaign = await this.findOne(tenantId, campaignId);

    if (!([CampaignStatus.DRAFT, CampaignStatus.SCHEDULED] as CampaignStatus[]).includes(campaign.status as CampaignStatus)) {
      throw new BadRequestException('Campaign cannot be launched in its current state');
    }

    if (campaign.scheduledAt && campaign.scheduledAt > new Date()) {
      await this.scheduledQueue.add(
        'launch-campaign',
        { campaignId, tenantId },
        { delay: campaign.scheduledAt.getTime() - Date.now() },
      );
      return this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SCHEDULED },
      });
    }

    return this.startSending(tenantId, campaignId);
  }

  async startSending(tenantId: string, campaignId: string) {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.RUNNING, startedAt: new Date() },
    });

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { campaignId, status: 'PENDING' },
      select: { id: true },
    });

    const batches: string[][] = [];
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      batches.push(recipients.slice(i, i + BATCH_SIZE).map((r) => r.id));
    }

    await Promise.all(
      batches.map((batch, index) =>
        this.campaignQueue.add(
          'send-batch',
          { campaignId, tenantId, batchIndex: index, recipientIds: batch },
          {
            delay: index * 2000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        ),
      ),
    );

    return { message: 'Campaign launched', batches: batches.length };
  }

  async getRecipients(
    tenantId: string,
    campaignId: string,
    page = 1,
    limit = 50,
    status?: string,
    search?: string,
  ) {
    await this.findOne(tenantId, campaignId);
    const skip = getPaginationSkip(page, limit);

    const where: Record<string, unknown> = { campaignId };
    if (status && status !== 'ALL') where['status'] = status;
    if (search) {
      where['contact'] = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.campaignRecipient.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
        include: {
          contact: { select: { id: true, name: true, phone: true, email: true } },
        },
      }),
      this.prisma.campaignRecipient.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async estimateRecipients(
    tenantId: string,
    opts: { segmentId?: string; labels?: string[]; phones?: string[] },
  ) {
    let count = 0;

    if (opts.segmentId) {
      const segment = await this.prisma.contactSegment.findFirst({ where: { id: opts.segmentId, tenantId } });
      if (segment) {
        const filters = segment.filters as unknown as SegmentFilter[];
        const where = { ...buildContactWhere(tenantId, filters), isBlocked: false, optedOut: false };
        count = await this.prisma.contact.count({ where });
      }
    } else if (opts.labels?.length) {
      count = await this.prisma.contact.count({
        where: { tenantId, labels: { hasSome: opts.labels }, isBlocked: false, optedOut: false },
      });
    } else if (opts.phones?.length) {
      const normalized = opts.phones.map(normalizePhone);
      count = await this.prisma.contact.count({
        where: { tenantId, phone: { in: normalized }, isBlocked: false, optedOut: false },
      });
    } else {
      count = await this.prisma.contact.count({ where: { tenantId, isBlocked: false, optedOut: false } });
    }

    return { count };
  }

  async delete(tenantId: string, campaignId: string) {
    const campaign = await this.findOne(tenantId, campaignId);
    if (!([CampaignStatus.DRAFT, CampaignStatus.SCHEDULED, CampaignStatus.FAILED] as CampaignStatus[]).includes(campaign.status as CampaignStatus)) {
      throw new BadRequestException('Only draft, scheduled, or failed campaigns can be deleted');
    }
    await this.prisma.campaignRecipient.deleteMany({ where: { campaignId } });
    await this.prisma.campaign.delete({ where: { id: campaignId } });
    return { deleted: true };
  }

  async pause(tenantId: string, campaignId: string) {
    const campaign = await this.findOne(tenantId, campaignId);
    if (campaign.status !== CampaignStatus.RUNNING) {
      throw new BadRequestException('Only running campaigns can be paused');
    }
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.PAUSED },
    });
  }

  async resume(tenantId: string, campaignId: string) {
    const campaign = await this.findOne(tenantId, campaignId);
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('Only paused campaigns can be resumed');
    }
    // Re-queue all remaining PENDING recipients — previously queued jobs were skipped
    return this.startSending(tenantId, campaignId);
  }
}
