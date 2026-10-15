import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { QueueName, WebhookDeliveryJob } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fires the tenant webhooks configured in Manage > Webhooks.
 *
 * The event names are the ones the Manage page already offers. Each matching, active webhook
 * gets one job on QueueName.WEBHOOK_PROCESS; apps/worker delivers it (signing + retries).
 * Dispatch is best-effort and never throws into the caller: messaging must not depend on
 * a customer's webhook endpoint.
 */
export type WebhookEvent =
  | 'message.received'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'conversation.assigned';

const DELIVERY_ATTEMPTS = 5;
const BACKOFF_MS = 30_000; // 30s, 60s, 120s, 240s

const CONVERSATION_SELECT = {
  id: true,
  status: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
  channel: { select: { id: true, type: true, name: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  contact: { select: { id: true, phone: true, name: true, email: true, createdAt: true, updatedAt: true } },
} as const;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  direction: true,
  type: true,
  status: true,
  content: true,
  mediaUrl: true,
  mediaType: true,
  mediaCaption: true,
  whatsappMessageId: true,
  replyToId: true,
  createdAt: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  failedAt: true,
  failureReason: true,
  sender: { select: { id: true, name: true } },
} as const;

@Injectable()
export class WebhookEventsService {
  private readonly logger = new Logger(WebhookEventsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QueueName.WEBHOOK_PROCESS) private queue: Queue<WebhookDeliveryJob>,
  ) {}

  /** A message was created (inbound from a customer, or outbound from an agent/bot/campaign). */
  messageCreated(tenantId: string, messageId: string, direction: string, status?: string) {
    const event: WebhookEvent =
      direction === 'INBOUND' ? 'message.received' : status === 'FAILED' ? 'message.failed' : 'message.sent';
    void this.dispatchMessage(tenantId, messageId, event);
  }

  /** Delivery receipt from WhatsApp for an outbound message. */
  messageStatusChanged(tenantId: string, messageId: string, status: string) {
    const event: WebhookEvent | null =
      status === 'DELIVERED' ? 'message.delivered' : status === 'READ' ? 'message.read' : status === 'FAILED' ? 'message.failed' : null;
    if (event) void this.dispatchMessage(tenantId, messageId, event);
  }

  conversationAssigned(tenantId: string, conversationId: string) {
    void this.safely(async () => {
      const webhookIds = await this.subscribers(tenantId, 'conversation.assigned');
      if (!webhookIds.length) return;
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: CONVERSATION_SELECT,
      });
      if (!conversation) return;
      const { contact, ...conv } = conversation;
      await this.enqueue(webhookIds, tenantId, 'conversation.assigned', { conversation: conv, contact });
    });
  }

  private async dispatchMessage(tenantId: string, messageId: string, event: WebhookEvent) {
    await this.safely(async () => {
      const webhookIds = await this.subscribers(tenantId, event);
      if (!webhookIds.length) return;
      const message = await this.prisma.message.findFirst({
        where: { id: messageId, tenantId },
        select: { ...MESSAGE_SELECT, conversation: { select: CONVERSATION_SELECT } },
      });
      // Internal agent notes never leave VerzChat.
      if (!message || message.type === 'NOTE') return;
      const { conversation, ...msg } = message;
      const { contact, ...conv } = conversation;
      await this.enqueue(webhookIds, tenantId, event, { message: msg, conversation: conv, contact });
    });
  }

  private async subscribers(tenantId: string, event: WebhookEvent): Promise<string[]> {
    const webhooks = await this.prisma.webhook.findMany({
      where: { tenantId, isActive: true, OR: [{ events: { has: event } }, { events: { has: '*' } }] },
      select: { id: true },
    });
    return webhooks.map((w) => w.id);
  }

  private async enqueue(webhookIds: string[], tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
    const occurredAt = new Date().toISOString();
    for (const webhookId of webhookIds) {
      const deliveryId = randomUUID();
      await this.queue.add(
        event,
        { deliveryId, webhookId, tenantId, event, occurredAt, data },
        {
          jobId: deliveryId,
          attempts: DELIVERY_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_MS },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    }
  }

  private async safely(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`Webhook dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
