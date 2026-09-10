import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookSource, WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { redactSecrets } from '../redact.util';

export interface RecordWebhookReceivedInput {
  source: WebhookSource;
  eventType: string;
  gatewayEventId?: string;
  tenantId?: string;
  payload?: unknown;
}

export interface ListWebhookEventsParams {
  source?: WebhookSource;
  status?: WebhookEventStatus;
  tenantId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);

  constructor(private prisma: PrismaService) {}

  /** Never throws -- webhook-event logging must not block the webhook it's observing. */
  async recordReceived(input: RecordWebhookReceivedInput): Promise<string | undefined> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          source: input.source,
          eventType: input.eventType,
          gatewayEventId: input.gatewayEventId,
          tenantId: input.tenantId,
          payload: (redactSecrets(input.payload) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: WebhookEventStatus.RECEIVED,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.logger.warn(`Failed to record webhook event: ${String(err)}`);
      return undefined;
    }
  }

  async markOutcome(id: string | undefined, status: 'PROCESSED' | 'FAILED', error?: string): Promise<void> {
    if (!id) return;
    try {
      await this.prisma.webhookEvent.update({
        where: { id },
        data: { status, error: error?.slice(0, 2000), processedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Failed to update webhook event outcome: ${String(err)}`);
    }
  }

  /** Associates a webhook event with the tenant it turned out to belong to, once resolved downstream of receipt. */
  async attachTenant(id: string | undefined, tenantId: string | undefined): Promise<void> {
    if (!id || !tenantId) return;
    try {
      await this.prisma.webhookEvent.update({ where: { id }, data: { tenantId } });
    } catch (err) {
      this.logger.warn(`Failed to attach tenant to webhook event: ${String(err)}`);
    }
  }

  async list(params: ListWebhookEventsParams) {
    const { source, status, tenantId, limit = 50, offset = 0 } = params;
    const where = {
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(tenantId ? { tenantId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async findOne(id: string) {
    return this.prisma.webhookEvent.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });
  }

  async markReprocessed(id: string, status: 'PROCESSED' | 'FAILED', error?: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status, error: error?.slice(0, 2000) ?? null, processedAt: new Date(), attempts: { increment: 1 } },
    });
  }
}
