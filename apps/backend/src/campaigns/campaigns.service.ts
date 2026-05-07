import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { QueueName } from '@whatsapp-platform/shared-types';
import { CampaignStatus } from '@whatsapp-platform/shared-types';

const BATCH_SIZE = 50;

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(QueueName.CAMPAIGN_SEND) private campaignQueue: Queue,
    @InjectQueue(QueueName.SCHEDULED_CAMPAIGN) private scheduledQueue: Queue,
  ) {}

  async create(tenantId: string, createdById: string, dto: CreateCampaignDto) {
    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, tenantId, status: 'APPROVED' },
    });
    if (!template) throw new BadRequestException('Template not found or not approved');

    let contactIds = dto.contactIds ?? [];

    if (dto.labels?.length && !contactIds.length) {
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, labels: { hasSome: dto.labels }, isBlocked: false, optedOut: false },
        select: { id: true },
      });
      contactIds = contacts.map((c) => c.id);
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        createdById,
        name: dto.name,
        templateId: dto.templateId,
        templateVariables: dto.templateVariables ?? undefined,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
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
        include: { template: { select: { name: true, language: true } } },
      }),
      this.prisma.campaign.count({ where: { tenantId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId },
      include: {
        template: true,
        _count: { select: { recipients: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
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
}
