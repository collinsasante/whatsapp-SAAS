import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAiService } from '../ai/commerce-ai.service';

/**
 * Dashboard "test as a customer" chat: runs a typed message through the REAL
 * commerce AI flow -- real Contact/Conversation/Message rows, real orders,
 * real Paystack transaction initialization (test or live key, whatever the
 * environment has). The only thing skipped is the WhatsApp transport itself.
 *
 * This is deliberately NOT the eval harness (no isEvalContact/dryRun flags):
 * the point is to exercise exactly what a real customer conversation would,
 * end to end, including payment collection and webhook/verify promotion.
 * Conversations are tagged contactSource='dashboard_test' and created
 * RESOLVED so they stay out of the open-inbox queue.
 */
@Injectable()
export class CommerceTestChatService {
  constructor(
    private prisma: PrismaService,
    private commerceAi: CommerceAiService,
  ) {}

  /** One stable synthetic customer per admin user, so history/orders persist across page loads. */
  private phoneFor(userId: string): string {
    return `+000TEST${userId.replace(/-/g, '').slice(0, 10)}`;
  }

  private async ensureCommerceEnabled(tenantId: string) {
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { commerceEnabled: true },
    });
    if (!settings?.commerceEnabled) {
      throw new BadRequestException('Commerce is not enabled for this workspace -- enable it before testing the commerce AI');
    }
  }

  private async findOrCreateSession(tenantId: string, userId: string, forceNew = false) {
    const phone = this.phoneFor(userId);
    let contact = await this.prisma.contact.findFirst({ where: { tenantId, phone } });
    if (!contact) {
      contact = await this.prisma.contact.create({
        data: { tenantId, phone, name: 'Test Customer (you)' },
      });
    }

    let conversation = forceNew
      ? null
      : await this.prisma.conversation.findFirst({
          where: { tenantId, contactId: contact.id, contactSource: 'dashboard_test' },
          orderBy: { createdAt: 'desc' },
        });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId, contactId: contact.id, contactSource: 'dashboard_test', status: 'RESOLVED' },
      });
    }
    return { contact, conversation };
  }

  private currentOrder(tenantId: string, conversationId: string) {
    return this.prisma.order.findFirst({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  /** Restore the current test session (history + latest order) for page load. */
  async getState(tenantId: string, userId: string) {
    await this.ensureCommerceEnabled(tenantId);
    const { contact, conversation } = await this.findOrCreateSession(tenantId, userId);
    const [messages, order] = await Promise.all([
      this.prisma.message.findMany({
        where: { tenantId, conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, direction: true, content: true, createdAt: true },
      }),
      this.currentOrder(tenantId, conversation.id),
    ]);
    return { conversationId: conversation.id, contactId: contact.id, messages, order };
  }

  /** Start a fresh conversation (new cart/order context), keeping the same synthetic customer. */
  async reset(tenantId: string, userId: string) {
    await this.ensureCommerceEnabled(tenantId);
    const { conversation } = await this.findOrCreateSession(tenantId, userId, true);
    return { conversationId: conversation.id, messages: [], order: null };
  }

  async sendMessage(tenantId: string, userId: string, message: string) {
    await this.ensureCommerceEnabled(tenantId);
    const text = message.trim();
    if (!text) throw new BadRequestException('Message is required');

    const { contact, conversation } = await this.findOrCreateSession(tenantId, userId);
    const phone = this.phoneFor(userId);

    await this.prisma.message.create({
      data: { tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', type: 'TEXT', status: 'DELIVERED', content: text },
    });

    const result = await this.commerceAi.handleMessage(tenantId, conversation.id, contact.id, phone, text, contact.name ?? undefined);

    await this.prisma.message.create({
      data: {
        tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'OUTBOUND', type: 'TEXT', status: 'SENT',
        content: result.response || '(no response)', metadata: { aiGenerated: true, commerce: true, dashboardTest: true },
      },
    });

    const order = await this.currentOrder(tenantId, conversation.id);

    return {
      conversationId: conversation.id,
      response: result.response,
      blocked: result.blocked,
      toolTrace: result.toolTrace ?? [],
      order,
    };
  }
}
