import { Worker, Job, UnrecoverableError } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { QueueName, WebhookDeliveryJob } from '@whatsapp-platform/shared-types';

const TIMEOUT_MS = 10_000;

/**
 * Delivers tenant webhooks (Manage > Webhooks) enqueued by the backend's WebhookEventsService.
 *
 * Body: { id, event, timestamp, tenantId, data } -- same shape as the existing "Test" delivery.
 * Headers: X-Webhook-Secret (existing mechanism), plus X-Webhook-Event, X-Webhook-Delivery,
 * X-Webhook-Timestamp and X-Webhook-Signature = sha256=HMAC_SHA256(secret, `${timestamp}.${body}`)
 * so receivers can also verify integrity and reject replays.
 *
 * Network errors, 5xx, 408 and 429 are retried with backoff (job options set by the backend);
 * any other 4xx is permanent. After the last attempt the webhook's failureCount is incremented.
 */
export class WebhookDeliveryWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<WebhookDeliveryJob>(QueueName.WEBHOOK_PROCESS, this.process.bind(this), {
      connection: this.connection,
      concurrency: 10,
    });

    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const finalAttempt = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      console.error(`Webhook delivery ${job.data.deliveryId} (${job.data.event}) attempt ${job.attemptsMade} failed: ${err.message}`);
      if (finalAttempt) {
        void this.prisma.webhook
          .updateMany({ where: { id: job.data.webhookId }, data: { failureCount: { increment: 1 } } })
          .catch(() => undefined);
      }
    });

    console.log('Webhook delivery worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<WebhookDeliveryJob>) {
    const { deliveryId, webhookId, tenantId, event, occurredAt, data } = job.data;

    // Re-read on every attempt: a webhook disabled or deleted meanwhile must not receive data.
    const webhook = await this.prisma.webhook.findFirst({ where: { id: webhookId, tenantId, isActive: true } });
    if (!webhook) return;

    const body = JSON.stringify({ id: deliveryId, event, timestamp: occurredAt, tenantId, data });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const customHeaders = (webhook.headers as Record<string, string> | null) ?? {};
    const headers: Record<string, string> = {
      ...customHeaders,
      'Content-Type': 'application/json',
      'User-Agent': 'VerzChat-Webhooks/1.0',
      'X-Webhook-Event': event,
      'X-Webhook-Delivery': deliveryId,
      'X-Webhook-Timestamp': timestamp,
    };
    if (webhook.secret) {
      headers['X-Webhook-Secret'] = webhook.secret;
      headers['X-Webhook-Signature'] = `sha256=${createHmac('sha256', webhook.secret).update(`${timestamp}.${body}`).digest('hex')}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let status: number;
    try {
      const res = await fetch(webhook.url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
      status = res.status;
    } catch (error) {
      throw new Error(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    if (status >= 200 && status < 300) {
      await this.prisma.webhook.update({ where: { id: webhook.id }, data: { lastTriggeredAt: new Date(), failureCount: 0 } });
      return;
    }
    if (status === 408 || status === 429 || status >= 500) {
      throw new Error(`HTTP ${status}`);
    }
    throw new UnrecoverableError(`HTTP ${status}`);
  }
}
