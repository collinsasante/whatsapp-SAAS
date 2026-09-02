import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../../messages/messages.service';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 20_000;

/**
 * Dashboard "test as a customer" chat for the general Verz-AI responder --
 * the commerce equivalent (CommerceTestChatService) calls its AI service
 * directly, but the general responder's entry point is
 * MessagesService.handleInbound(), which is fire-and-forget internally (real
 * WhatsApp webhook traffic never awaits the AI). Rather than refactor that
 * delicate, multi-branch method (welcome message, chatbot flows, commerce
 * gate, SUGGESTION/AUTO_REPLY) to expose an awaitable variant, this calls the
 * REAL production entry point unmodified and polls for the row it produces --
 * proven to work, this is the exact technique used to verify the v2 pipeline
 * end-to-end during development. Testing through the real entry point is also
 * more faithful than bypassing it: a tenant's actual chatbot flows or welcome
 * message will fire too, exactly as they would for a real customer.
 */
@Injectable()
export class AiTestChatService {
  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
  ) {}

  /**
   * Must be purely numeric (after the leading +): handleInbound() ultimately calls
   * ContactsService.findOrCreate(), which runs the phone through normalizePhone()
   * (strips every non-digit character). A letter-containing synthetic phone would
   * get mangled by that strip and never match what this service looks up under
   * its own key -- two different Contact rows, broken conversation continuity.
   */
  private phoneFor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    return `+000${hash.toString().padStart(10, '0').slice(0, 10)}`;
  }

  private async ensureAiEnabled(tenantId: string) {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { aiEnabled: true } });
    if (!settings?.aiEnabled) {
      throw new BadRequestException('Verz AI is not enabled for this workspace -- enable it on this page before testing.');
    }
  }

  private async findOrCreateSession(tenantId: string, userId: string, forceNew = false) {
    const phone = this.phoneFor(userId);
    let contact = await this.prisma.contact.findFirst({ where: { tenantId, phone } });
    if (!contact) {
      contact = await this.prisma.contact.create({ data: { tenantId, phone, name: 'Test Customer (you)' } });
    }

    let conversation = forceNew
      ? null
      : await this.prisma.conversation.findFirst({
          where: { tenantId, contactId: contact.id, contactSource: 'dashboard_test_ai' },
          orderBy: { createdAt: 'desc' },
        });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId, contactId: contact.id, contactSource: 'dashboard_test_ai', status: 'RESOLVED' },
      });
    }
    return { contact, conversation };
  }

  async getState(tenantId: string, userId: string) {
    await this.ensureAiEnabled(tenantId);
    const { contact, conversation } = await this.findOrCreateSession(tenantId, userId);
    const [messages, logs] = await Promise.all([
      this.prisma.message.findMany({
        where: { tenantId, conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, direction: true, content: true, createdAt: true },
      }),
      this.prisma.aiInteractionLog.findMany({
        where: { tenantId, conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { conversationId: conversation.id, messages, suggestions: logs };
  }

  async reset(tenantId: string, userId: string) {
    await this.ensureAiEnabled(tenantId);
    const { conversation } = await this.findOrCreateSession(tenantId, userId, true);
    return { conversationId: conversation.id, messages: [], suggestions: [] };
  }

  async sendMessage(tenantId: string, userId: string, message: string) {
    await this.ensureAiEnabled(tenantId);
    const text = message.trim();
    if (!text) throw new BadRequestException('Message is required');

    const { contact, conversation } = await this.findOrCreateSession(tenantId, userId);
    const phone = this.phoneFor(userId);
    const sentAt = new Date();

    await this.messagesService.handleInbound(
      tenantId,
      { id: `test-${Date.now()}`, from: phone.replace('+', ''), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } },
      contact.name ?? undefined,
    );

    // handleInbound's AI branch is fire-and-forget (real webhook traffic never awaits
    // it) -- poll for whichever row it produces: a SUGGESTED AiInteractionLog
    // (suggestion mode, never auto-sent) or a new outbound Message (auto-reply mode).
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [log, outboundMessage] = await Promise.all([
        this.prisma.aiInteractionLog.findFirst({
          where: { tenantId, conversationId: conversation.id, createdAt: { gt: sentAt } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.message.findFirst({
          where: { tenantId, conversationId: conversation.id, direction: 'OUTBOUND', createdAt: { gt: sentAt } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      if (log || outboundMessage) {
        return {
          conversationId: conversation.id,
          mode: log ? ('SUGGESTION' as const) : ('AUTO_REPLY' as const),
          suggestion: log,
          message: outboundMessage,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return {
      conversationId: conversation.id,
      mode: 'TIMEOUT' as const,
      suggestion: null,
      message: null,
      note: 'No AI response after 20s -- either a chatbot flow matched instead, AI mode is off, or the provider call is still running. Check the AI Activity tab for a trace.',
    };
  }
}
