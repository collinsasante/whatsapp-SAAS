import { Worker, Job } from 'bullmq';
import { PrismaClient, MessageDirection, MessageType, MessageStatus } from '@prisma/client';
import axios from 'axios';
import { QueueName, AutomationTriggerJob, AutomationActionConfig, AutomationAction } from '@whatsapp-platform/shared-types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { phoneNumberId: true, accessToken: true },
    });

    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;

    for (const action of actions) {
      try {
        await this.executeAction(action, { tenantId, conversationId, contactId, contact, tenant });
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
      tenant: { phoneNumberId: string | null; accessToken: string | null } | null;
    },
  ) {
    const payload = action.payload as Record<string, string>;

    switch (action.type) {
      case AutomationAction.SEND_MESSAGE: {
        if (!ctx.tenant?.phoneNumberId || !ctx.tenant.accessToken) break;
        const response = await axios.post(
          `${GRAPH_API_BASE}/${ctx.tenant.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: ctx.contact.phone,
            type: 'text',
            text: { body: payload['message'] ?? 'Hello!' },
          },
          { headers: { Authorization: `Bearer ${ctx.tenant.accessToken}` }, timeout: 15000 },
        );
        await this.prisma.message.create({
          data: {
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            contactId: ctx.contactId,
            whatsappMessageId: response.data.messages[0].id as string,
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
          data: { status: 'RESOLVED' },
        });
        break;
      }

      case AutomationAction.SEND_TEMPLATE: {
        const templateId = payload['templateId'];
        if (!templateId || !ctx.tenant?.phoneNumberId || !ctx.tenant.accessToken) break;
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
          `${GRAPH_API_BASE}/${ctx.tenant.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: ctx.contact.phone,
            type: 'template',
            template: { name: template.name, language: { code: template.language }, components },
          },
          { headers: { Authorization: `Bearer ${ctx.tenant.accessToken}` }, timeout: 15000 },
        );
        await this.prisma.message.create({
          data: {
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            contactId: ctx.contactId,
            whatsappMessageId: response.data.messages[0].id as string,
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
}
