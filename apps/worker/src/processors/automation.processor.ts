import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MessageDirection, MessageType, MessageStatus } from '@whatsapp-platform/shared-types';
import axios from 'axios';
import { QueueName, AutomationTriggerJob, AutomationActionConfig, AutomationAction } from '@whatsapp-platform/shared-types';
import { resolveWhatsAppCredentials, GRAPH_API_BASE, WhatsAppCredentials } from '../lib/whatsapp-credentials';

export class AutomationWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<AutomationTriggerJob>(
      QueueName.AUTOMATION_TRIGGER,
      this.process.bind(this),
      {
        connection: this.connection,
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`Automation job ${job?.id} failed:`, err.message);
    });

    console.log('Automation worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<AutomationTriggerJob>) {
    const { tenantId, ruleId, conversationId, contactId } = job.data;

    const rule = await this.prisma.automationRule.findFirst({
      where: { id: ruleId, tenantId, isActive: true },
    });

    if (!rule) return;

    const actions = rule.actions as unknown as AutomationActionConfig[];
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { whatsappNumberId: true, channelId: true, channel: { select: { type: true } } },
    });
    // WHATSAPP_WEB conversations have no whatsappNumberId (that field is
    // Cloud-API-number-specific) -- resolving Cloud credentials for them
    // would silently fall back to the tenant's *default* Cloud API number
    // (resolveWhatsAppCredentials' no-whatsappNumberId branch), sending an
    // automation message via the wrong provider entirely if the tenant also
    // has a Cloud number connected. Skip Cloud credential resolution for
    // WHATSAPP_WEB conversations; SEND_MESSAGE resolves its own WhatsApp Web
    // session below instead.
    const isWhatsAppWeb = conversation?.channel?.type === 'WHATSAPP_WEB';
    const credentials = isWhatsAppWeb ? null : await resolveWhatsAppCredentials(this.prisma, tenantId, conversation?.whatsappNumberId);

    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    // This processor is WhatsApp-only (see the ctx.contact.phone-shaped actions
    // below) -- a contact reached via a non-phone platform identifier has
    // nothing this worker can currently act on.
    if (!contact || !contact.phone) return;

    for (const action of actions) {
      try {
        // Non-null assertion is safe here -- the guard above already returned
        // for any contact with no phone (narrowing contact.phone doesn't
        // narrow the whole `contact` object's static type once it's passed
        // by reference into executeAction's differently-typed param).
        await this.executeAction(action, {
          tenantId, conversationId, contactId, contact: { ...contact, phone: contact.phone! }, credentials,
          whatsappNumberId: conversation?.whatsappNumberId ?? null,
          whatsAppWebChannelId: isWhatsAppWeb ? (conversation?.channelId ?? null) : null,
        });
      } catch (error) {
        console.error(`Failed to execute action ${action.type}:`, error instanceof Error ? error.message : String(error));
      }
    }

    await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { executionCount: { increment: 1 } },
    });
  }

  private async executeAction(
    action: AutomationActionConfig,
    ctx: {
      tenantId: string;
      conversationId: string;
      contactId: string;
      contact: { phone: string; name: string | null };
      credentials: WhatsAppCredentials | null;
      whatsappNumberId: string | null;
      whatsAppWebChannelId: string | null;
    },
  ) {
    const payload = action.payload as Record<string, string>;

    switch (action.type) {
      case AutomationAction.SEND_MESSAGE: {
        // Unofficial WhatsApp Web (QR/linked-device) conversation -- send via
        // the real Baileys session through apps/whatsapp-web's internal HTTP
        // API, same direct-HTTP pattern this worker already uses for Meta's
        // Graph API (no NestJS DI here), not the Cloud API branch below.
        if (ctx.whatsAppWebChannelId) {
          await this.sendWhatsAppWebMessage(ctx.tenantId, ctx.whatsAppWebChannelId, ctx.conversationId, ctx.contactId, ctx.contact.phone, payload['message'] ?? 'Hello!');
          break;
        }
        if (!ctx.credentials) break;
        const response = await axios.post(
          `${GRAPH_API_BASE}/${ctx.credentials.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: ctx.contact.phone,
            type: 'text',
            text: { body: payload['message'] ?? 'Hello!' },
          },
          { headers: { Authorization: `Bearer ${ctx.credentials.accessToken}` }, timeout: 15000 },
        );
        await this.prisma.message.create({
          data: {
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            contactId: ctx.contactId,
            whatsappMessageId: response.data.messages[0].id as string,
            whatsappNumberId: ctx.whatsappNumberId,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.SENT,
            content: payload['message'],
            sentAt: new Date(),
          },
        });
        break;
      }

      case AutomationAction.ASSIGN_AGENT: {
        const agentId = payload['agentId'];
        if (agentId) {
          await this.prisma.conversation.update({
            where: { id: ctx.conversationId },
            data: { assignedToId: agentId },
          });
        }
        break;
      }

      case AutomationAction.ADD_LABEL: {
        const label = payload['label'];
        if (label) {
          await this.prisma.conversation.update({
            where: { id: ctx.conversationId },
            data: { labels: { push: label } },
          });
        }
        break;
      }

      case AutomationAction.RESOLVE_CONVERSATION: {
        await this.prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        break;
      }

      case AutomationAction.UNASSIGN_AGENT: {
        await this.prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { assignedToId: null },
        });
        break;
      }

      case AutomationAction.REMOVE_LABEL: {
        const label = payload['label'];
        if (label) {
          const conv = await this.prisma.conversation.findUnique({
            where: { id: ctx.conversationId },
            select: { labels: true },
          });
          if (conv) {
            await this.prisma.conversation.update({
              where: { id: ctx.conversationId },
              data: { labels: conv.labels.filter((l) => l !== label) },
            });
          }
        }
        break;
      }

      case AutomationAction.ADD_NOTE: {
        const note = payload['note'];
        if (note) {
          // Use the tenant's AI agent user as author; fall back to first admin
          const author = await this.prisma.user.findFirst({
            where: { tenantId: ctx.tenantId, OR: [{ isAiAgent: true }, { role: 'ADMIN' }] },
            orderBy: { isAiAgent: 'desc' },
            select: { id: true },
          });
          if (author) {
            await this.prisma.conversationNote.create({
              data: { conversationId: ctx.conversationId, authorId: author.id, content: note },
            });
          }
        }
        break;
      }

      case AutomationAction.SEND_WEBHOOK: {
        const url = payload['url'];
        if (url) {
          await axios.post(
            url,
            {
              event: 'automation.triggered',
              tenantId: ctx.tenantId,
              conversationId: ctx.conversationId,
              contactId: ctx.contactId,
              contact: { phone: ctx.contact.phone, name: ctx.contact.name },
              timestamp: new Date().toISOString(),
            },
            {
              headers: { 'Content-Type': 'application/json', ...(payload['secret'] ? { 'X-Webhook-Secret': payload['secret'] } : {}) },
              timeout: 10000,
            },
          );
        }
        break;
      }

      case AutomationAction.SEND_TEMPLATE: {
        const templateId = payload['templateId'];
        if (!templateId || !ctx.credentials) break;
        const template = await this.prisma.template.findUnique({ where: { id: templateId } });
        if (!template) break;
        const variables = payload as Record<string, string>;
        const components: Record<string, unknown>[] = [];
        const bodyVars = Object.keys(variables).filter((k) => k.startsWith('body_'));
        if (bodyVars.length) {
          components.push({
            type: 'body',
            parameters: bodyVars.sort().map((k) => ({ type: 'text', text: variables[k] })),
          });
        }
        const response = await axios.post(
          `${GRAPH_API_BASE}/${ctx.credentials.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: ctx.contact.phone,
            type: 'template',
            template: { name: template.name, language: { code: template.language }, components },
          },
          { headers: { Authorization: `Bearer ${ctx.credentials.accessToken}` }, timeout: 15000 },
        );
        await this.prisma.message.create({
          data: {
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            contactId: ctx.contactId,
            whatsappMessageId: response.data.messages[0].id as string,
            whatsappNumberId: ctx.whatsappNumberId,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEMPLATE,
            status: MessageStatus.SENT,
            templateId,
            sentAt: new Date(),
          },
        });
        break;
      }
    }
  }

  /**
   * SEND_MESSAGE for a WHATSAPP_WEB conversation -- calls apps/whatsapp-web's
   * internal send endpoint directly (same direct-HTTP pattern this worker
   * already uses for Meta's Graph API above, just a different URL). Always
   * persists a Message row (SENT or FAILED) so the attempt is visible in the
   * inbox either way, matching how the backend's own AI auto-reply path
   * handles a send that might fail.
   */
  private async sendWhatsAppWebMessage(
    tenantId: string,
    channelId: string,
    conversationId: string,
    contactId: string,
    toPhone: string,
    text: string,
  ): Promise<void> {
    const session = await this.prisma.whatsAppWebSession.findFirst({ where: { tenantId, channelId } });
    let providerMessageId: string | undefined;
    if (session && session.status === 'CONNECTED') {
      try {
        const baseUrl = process.env['WHATSAPP_WEB_INTERNAL_URL'] ?? 'http://whatsapp-web:3004';
        const apiKey = process.env['WHATSAPP_WEB_INTERNAL_API_KEY'] ?? '';
        const res = await axios.post<{ providerMessageId: string }>(
          `${baseUrl}/sessions/${session.id}/send-text`,
          { toPhone, text },
          { headers: { 'x-internal-api-key': apiKey }, timeout: 15000 },
        );
        providerMessageId = res.data.providerMessageId;
      } catch (err) {
        console.error(`[Automation] WhatsApp Web send failed for channel ${channelId}:`, err instanceof Error ? err.message : String(err));
      }
    }

    await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId,
        channelId,
        whatsappMessageId: providerMessageId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        status: providerMessageId ? MessageStatus.SENT : MessageStatus.FAILED,
        content: text,
        sentAt: providerMessageId ? new Date() : undefined,
      },
    });
  }
}
