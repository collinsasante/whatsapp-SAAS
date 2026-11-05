import { assertNotSimulatedRecipient } from '@whatsapp-platform/shared-utils';
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MessageStatus, MessageDirection, MessageType } from '@whatsapp-platform/shared-types';
import axios from 'axios';
import { QueueName, CampaignSendJob } from '@whatsapp-platform/shared-types';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';
import { randomBytes, randomUUID } from 'crypto';
import { claimRecipient, closeStaleClaims, recordAccepted, recordFailed } from '../lib/campaign-claims';
import { resolveWhatsAppCredentials, GRAPH_API_BASE } from '../lib/whatsapp-credentials';

const RATE_LIMIT_DELAY_MS = 1000;
const PUBLIC_BASE_URL = process.env['PUBLIC_BASE_URL'] ?? 'https://verzchat.com/api/v1';

export class CampaignSendWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
    /** Injected so tests can move time past the claim lease; production uses the real clock. */
    private now: () => Date = () => new Date(),
    /** Pause between recipients (Meta rate limiting). Injected so tests do not sleep. */
    private delayMs: number = RATE_LIMIT_DELAY_MS,
  ) {}

  start() {
    this.worker = new Worker<CampaignSendJob>(
      QueueName.CAMPAIGN_SEND,
      this.process.bind(this) as (job: Job<CampaignSendJob>) => Promise<void>,
      {
        connection: this.connection,
        concurrency: 2,
        limiter: { max: 20, duration: 1000 },
      },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`Campaign job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 1}):`, err.message);
      // BullMQ retries a thrown error up to `attempts` times. On the last one nothing will try again, so the batch's recipients
      // must reach a terminal state here, otherwise the campaign would stay RUNNING with PENDING recipients forever.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.failBatch(job.data, `Sending failed after ${job.attemptsMade} attempts: ${err.message}`).catch((e) => {
          console.error(`Could not close out failed batch of campaign ${job.data.campaignId}:`, e instanceof Error ? e.message : String(e));
        });
      }
    });

    this.worker.on('completed', (job) => {
      console.log(`Campaign batch ${job.data.batchIndex} for campaign ${job.data.campaignId} completed`);
    });

    console.log('Campaign send worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  /** Public so the crash-window and concurrency tests can drive one batch without a Redis queue. */
  async process(job: Pick<Job<CampaignSendJob>, 'data'>) {
    const { campaignId, tenantId, recipientIds } = job.data;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { template: true },
    });

    // Writing the inbox record for a message Meta already accepted never sends anything, so it is safe in every campaign state, including
    // COMPLETED (a crash after the acceptance was recorded but before the record was written leaves exactly that behind).
    if (campaign) await this.linkAcceptedMessages(job.data, campaign.whatsappNumberId, campaign.templateId, campaign.templateVariables);

    if (!campaign || campaign.status !== 'RUNNING') {
      // Paused, deleted, or already finished (COMPLETED / FAILED): never send for a campaign that is not running.
      console.log(`Campaign ${campaignId} is ${campaign?.status ?? 'not found'}, skipping batch`);
      return;
    }

    // null whatsappNumberId means "use the tenant's default number" --
    // backward compatible with every campaign created before multi-account
    // support existed.
    const credentials = await resolveWhatsAppCredentials(this.prisma, tenantId, campaign.whatsappNumberId);

    if (!credentials) {
      // Permanent: retrying cannot fix missing credentials, so the batch is closed out now instead of retried and then abandoned.
      console.error(`Campaign ${campaignId}: WhatsApp credentials are missing or invalid for this campaign's number; failing the batch`);
      await this.failBatch(job.data, "WhatsApp is not configured for this campaign's number");
      return;
    }

    // A previous run of this batch may have died mid-send. Finish what it provably did, and close what it left undecided, before sending anything.
    const closed = await closeStaleClaims(this.prisma, campaignId, recipientIds, this.now());
    if (closed > 0) console.error(`Campaign ${campaignId}: ${closed} recipient(s) were left mid-send by an interrupted worker; closed as "delivery unknown" instead of resending`);

    // Only recipients nobody has claimed: a recipient claimed by another worker, or by an earlier run, is never offered again.
    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { id: { in: recipientIds }, campaignId, status: 'PENDING', claimedAt: null },
      include: { contact: true },
    });

    for (const recipient of recipients) {
      // A pause (or any other change) must take effect inside a running batch, not only at the next one; otherwise a resumed
      // campaign could be re-queued while this batch is still sending the same recipients.
      const current = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (current?.status !== 'RUNNING') {
        console.log(`Campaign ${campaignId} is ${current?.status ?? 'gone'}; stopping this batch before recipient ${recipient.id}`);
        return;
      }

      const token = randomUUID();
      // Step 1: take the recipient. If another worker (or an earlier run) already did, this returns false and nothing is sent.
      if (!(await claimRecipient(this.prisma, recipient.id, campaignId, token, this.now()))) continue;

      if (recipient.contact.isBlocked || recipient.contact.optedOut) {
        if (await recordFailed(this.prisma, recipient.id, token, 'Contact blocked or opted out', null)) {
          await this.prisma.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: 1 } } });
        }
        continue;
      }

      let whatsappMessageId: string;
      try {
        const templateVariables = { ...((campaign.templateVariables as Record<string, string>) ?? {}) };

        // Generate a per-recipient click tracking code if campaign has a tracking URL
        if (campaign.trackingUrl) {
          const trackingCode = randomBytes(8).toString('hex');
          await this.prisma.campaignClick.create({
            data: { campaignId, contactId: recipient.contactId, code: trackingCode },
          });
          // Inject the short tracking URL as an extra variable so templates can include it
          templateVariables['tracking_url'] = `${PUBLIC_BASE_URL}/c/${trackingCode}`;
        }

        const components = buildTemplateComponents(campaign.template.components as never, templateVariables);
        assertNotSimulatedRecipient(recipient.contact.phone); // a simulated number never reaches Meta

        // Step 2: the one call that cannot be undone.
        const response = await axios.post(
          `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipient.contact.phone,
            type: 'template',
            template: {
              name: campaign.template.name,
              language: { code: campaign.template.language },
              components,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${credentials.accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          },
        );
        whatsappMessageId = response.data.messages[0].id as string;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Meta's Graph API error shape: { error: { message, type, code, error_subcode, fbtrace_id } }
        const errorCode = axios.isAxiosError(error)
          ? (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code ?? null
          : null;
        // A 4xx answer means Meta refused the message. No answer at all (timeout, reset) or a 5xx means we cannot know; it is still closed as
        // failed and never resent automatically, but the reason says so, so an operator does not assume it was not delivered.
        const unconfirmed = axios.isAxiosError(error) && (!error.response || error.response.status >= 500);
        const reason = unconfirmed ? `Delivery not confirmed (no definite answer from WhatsApp; not retried to avoid a duplicate): ${errorMsg}` : errorMsg;
        if (await recordFailed(this.prisma, recipient.id, token, reason, errorCode)) {
          await this.prisma.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: 1 } } });
        }
        continue;
      }

      // Step 3: write down that Meta accepted it, before anything else can go wrong. Retried briefly because losing this write is what
      // would later be reported as "delivery unknown".
      const accepted = await this.withRetries(() => recordAccepted(this.prisma, recipient.id, token, whatsappMessageId, this.now()));
      if (accepted) {
        await this.prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: { increment: 1 } } });
      }

      // Step 4: the inbox record. A failure here no longer matters for correctness: step 3 holds the message id, and the next run links it.
      try {
        await this.createAndLinkMessage(recipient.id, { tenantId, contactId: recipient.contactId, whatsappMessageId, whatsappNumberId: campaign.whatsappNumberId, templateId: campaign.templateId, templateVariables: campaign.templateVariables });
      } catch (error) {
        console.error(`Campaign ${campaignId}: recipient ${recipient.id} was sent but its message record could not be written yet (${error instanceof Error ? error.message : String(error)}); it will be linked on the next run`);
      }

      await this.sleep(this.delayMs);
    }

    await this.checkAndCompleteIfDone(campaignId);
  }

  /** Retries a small database write; the outcome of a send must not be lost to a blip. */
  private async withRetries<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        last = error;
        await this.sleep(150 * (i + 1));
      }
    }
    throw last;
  }

  private async createAndLinkMessage(
    recipientId: string,
    m: { tenantId: string; contactId: string; whatsappMessageId: string; whatsappNumberId?: string | null; templateId: string; templateVariables: unknown },
  ) {
    const message = await this.prisma.message.create({
      data: {
        tenantId: m.tenantId,
        conversationId: await this.getOrCreateConversation(m.tenantId, m.contactId, m.whatsappNumberId),
        contactId: m.contactId,
        whatsappMessageId: m.whatsappMessageId,
        whatsappNumberId: m.whatsappNumberId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        status: MessageStatus.SENT,
        templateId: m.templateId,
        templateVariables: (m.templateVariables as never) ?? undefined,
        sentAt: new Date(),
      },
    });
    await this.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { messageId: message.id } });
  }

  /** Recipients Meta accepted whose inbox record was never written (a crash or a database error after step 3): write it now, never resend. */
  private async linkAcceptedMessages(data: CampaignSendJob, whatsappNumberId: string | null, templateId: string, templateVariables: unknown) {
    const unlinked = await this.prisma.campaignRecipient.findMany({
      where: { id: { in: data.recipientIds }, campaignId: data.campaignId, status: 'SENT', messageId: null, whatsappMessageId: { not: null } },
    });
    for (const r of unlinked) {
      try {
        await this.createAndLinkMessage(r.id, { tenantId: data.tenantId, contactId: r.contactId, whatsappMessageId: r.whatsappMessageId as string, whatsappNumberId, templateId, templateVariables });
      } catch (error) {
        console.error(`Campaign ${data.campaignId}: could not link the sent message of recipient ${r.id}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async getOrCreateConversation(tenantId: string, contactId: string, whatsappNumberId?: string | null): Promise<string> {
    // Same dedup rule as ConversationsService.findOrCreate (apps/backend): match
    // this number's own open conversation or a legacy untagged one, never a
    // different number's -- so a campaign sent from "Sales" doesn't land in a
    // thread the contact has open with "Support".
    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId,
        status: { not: 'RESOLVED' },
        ...(whatsappNumberId && { OR: [{ whatsappNumberId }, { whatsappNumberId: null }] }),
      },
    });

    if (existing) {
      if (whatsappNumberId && !existing.whatsappNumberId) {
        await this.prisma.conversation.update({ where: { id: existing.id }, data: { whatsappNumberId } });
      }
      return existing.id;
    }

    const created = await this.prisma.conversation.create({
      data: { tenantId, contactId, whatsappNumberId },
    });

    return created.id;
  }

  /** Marks this batch's still-PENDING recipients FAILED (never touching SENT ones), counts them, and settles the campaign. */
  private async failBatch(data: CampaignSendJob, reason: string) {
    const { campaignId, tenantId, recipientIds } = data;
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { id: true } });
    if (!campaign) return;
    const { count } = await this.prisma.campaignRecipient.updateMany({
      where: { id: { in: recipientIds }, campaignId, status: 'PENDING' },
      data: { status: 'FAILED', errorMessage: reason.slice(0, 500) },
    });
    if (count > 0) {
      await this.prisma.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: count } } });
    }
    await this.checkAndCompleteIfDone(campaignId);
  }

  /**
   * Settles a campaign once no recipient is PENDING. Every recipient is SENT or FAILED by then, so: nothing sent and something
   * failed = FAILED; otherwise COMPLETED (failedCount > 0 means partially completed). Only a RUNNING campaign is settled, so a
   * paused or deleted campaign is never overwritten.
   */
  private async checkAndCompleteIfDone(campaignId: string) {
    const pending = await this.prisma.campaignRecipient.count({
      where: { campaignId, status: 'PENDING' },
    });
    if (pending > 0) return;

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true, sentCount: true, failedCount: true } });
    if (!campaign || campaign.status !== 'RUNNING') return;
    const status = campaign.sentCount === 0 && campaign.failedCount > 0 ? 'FAILED' : 'COMPLETED';
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status, completedAt: new Date() },
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
