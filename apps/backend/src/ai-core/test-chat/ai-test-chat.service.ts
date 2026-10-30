import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { SimulationLimitsService } from '../simulation/simulation-limits.service';
import { estimateSimulatedUsage } from '../simulation/simulation-usage.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../../messages/messages.service';
import { ConversationsService } from '../../conversations/conversations.service';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 20_000;
/** A simulated reply writes its interaction log first and its message a moment later; wait this long for the message. */
const SIMULATED_MESSAGE_GRACE_MS = 3_000;

const isSimulatedMessage = (m: { metadata?: unknown } | null | undefined): boolean =>
  (m?.metadata as { simulated?: boolean } | null | undefined)?.simulated === true;

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
 *
 * SIMULATION: the customer here is a synthetic contact whose number is in a reserved range no real recipient can have (see
 * shared-utils simulated-recipient). The inbound pipeline recognises it and never hands anything to a messaging provider: replies
 * are generated, stored as SIMULATED (never AUTO_SENT or SENT), run as the unmetered TEST task so no customer credits are
 * settled, create no real handoff, and are still evaluated. The provider clients and the worker refuse the number as a backstop.
 */
@Injectable()
export class AiTestChatService {
  private readonly logger = new Logger(AiTestChatService.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private limits: SimulationLimitsService,
  ) {}

  /**
   * The synthetic number is in the reserved range (see shared-utils simulated-recipient) and purely numeric after the leading +,
   * which matters: handleInbound() runs the phone through normalizePhone(), which strips every non-digit character, so a
   * letter-containing phone would be mangled and never match what this service looks up under its own key.
   */
  private phoneFor(userId: string): string {
    return simulatedPhoneFor(userId);
  }

  private async ensureAiEnabled(tenantId: string) {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { aiEnabled: true } });
    if (!settings?.aiEnabled) {
      throw new BadRequestException('Verz AI is not enabled for this workspace -- enable it on this page before testing.');
    }
  }

  /**
   * handleInbound() resolves "the" conversation for an inbound message via
   * ConversationsService.findOrCreate(), whose "existing" lookup is
   * `{tenantId, contactId, status: {not: RESOLVED}}` -- no contactSource
   * filter, no ordering. This method used to look up its own conversation by
   * `contactSource: 'dashboard_test_ai'` ordered by createdAt desc instead,
   * which drifted from handleInbound()'s pick as soon as this contact had more
   * than one non-resolved conversation (e.g. a prior test session left one
   * dangling): the AI's reply would land on whichever row handleInbound found
   * -- visible in the real Inbox -- while this page kept polling a different
   * row that never received it. Matching the same where-clause here guarantees
   * both always agree on which conversation is "current".
   */
  private async findOrCreateSession(tenantId: string, userId: string, forceNew = false) {
    const phone = this.phoneFor(userId);
    let contact = await this.prisma.contact.findFirst({ where: { tenantId, phone } });
    if (!contact) {
      contact = await this.prisma.contact.create({ data: { tenantId, phone, name: 'Test Customer (you)' } });
    }

    if (forceNew) {
      // Resolve any conversation handleInbound() would otherwise still treat as
      // the active one for this contact, so it can never keep receiving replies
      // this page has moved on from polling.
      const stale = await this.prisma.conversation.findFirst({
        where: { tenantId, contactId: contact.id, status: { not: 'RESOLVED' } },
      });
      if (stale) await this.conversationsService.resolve(tenantId, stale.id, userId).catch(() => null);
    }

    let conversation = forceNew
      ? null
      : await this.prisma.conversation.findFirst({
          where: { tenantId, contactId: contact.id, status: { not: 'RESOLVED' } },
        });
    // With no open conversation, ConversationsService.findOrCreate REOPENS the most recently updated resolved one, so that is the
    // conversation the AI will answer in. This must mirror it: creating a new one here left the conversation just handed out by
    // reset() unused, and anything done to it (for example choosing a Digital Self) never applied to the reply.
    if (!conversation && !forceNew) {
      conversation = await this.prisma.conversation.findFirst({
        where: { tenantId, contactId: contact.id, status: 'RESOLVED' },
        orderBy: { updatedAt: 'desc' },
      });
    }
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
        select: { id: true, direction: true, content: true, createdAt: true, metadata: true },
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

  /**
   * Today's simulated usage for this tenant: the counters against the limits, plus what the provider actually reported, read from the
   * stored executions (tokens exactly as the provider sent them). The cost is an ESTIMATE from the model catalog's rates, only for
   * calls whose tokens are known; anything else is counted as unknown, never guessed.
   */
  async getUsage(tenantId: string, userId: string) {
    const usage = await this.limits.usage(tenantId, userId);
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const rows = await this.prisma.aiExecution.findMany({
      where: { tenantId, taskType: 'TEST', createdAt: { gte: since }, safetyFlags: { path: ['simulated'], equals: true } },
      select: { modelKey: true, status: true, inputTokens: true, outputTokens: true, estCostUsd: true },
      take: 5000,
    });
    return { ...usage, providerUsageToday: estimateSimulatedUsage(rows.map((r) => ({ ...r, estCostUsd: r.estCostUsd === null ? null : Number(r.estCostUsd) }))) };
  }

  /**
   * One simulated customer message. Order matters: cheap checks first (nothing spent), then the guarded run, which recognises a retry
   * of an already-processed request id (replayed from the stored result, no quota, no provider call), checks the conversation has
   * room, takes the per-user and per-tenant allowances atomically, and only then calls the AI.
   */
  async sendMessage(tenantId: string, userId: string, message: string, requestId?: string) {
    await this.ensureAiEnabled(tenantId);
    const text = message.trim();
    if (!text) throw new BadRequestException('Message is required');
    this.limits.assertInputSize(tenantId, text);

    let session: Awaited<ReturnType<AiTestChatService['findOrCreateSession']>> | undefined;
    const { value, replayed } = await this.limits.execute(
      {
        tenantId, userId, kind: 'test-chat', requestId,
        precheck: async () => {
          session = await this.findOrCreateSession(tenantId, userId);
          const turns = await this.prisma.message.count({ where: { tenantId, conversationId: session.conversation.id, direction: 'INBOUND' } });
          this.limits.assertConversationRoom(tenantId, turns);
        },
      },
      () => this.process(tenantId, userId, text, session!),
    );
    return replayed ? { ...value, replayed: true } : value;
  }

  private async process(tenantId: string, userId: string, text: string, session: { contact: { name: string | null }; conversation: { id: string } }) {
    const { contact, conversation } = session;
    const phone = this.phoneFor(userId);
    const sentAt = new Date();

    await this.messagesService.handleInbound(
      tenantId,
      { id: `test-${Date.now()}`, from: phone.replace('+', ''), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } },
      contact.name ?? undefined,
    );

    // handleInbound's AI branch is fire-and-forget (real webhook traffic never awaits
    // it) -- poll for whichever row it produces: a SUGGESTED AiInteractionLog (suggestion
    // mode, a draft that is never sent) or, in auto-reply mode, a SIMULATED log plus its
    // stored (never delivered) message. The mode reported to the page comes from what was
    // actually recorded, never from the mere existence of a log.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let logSeenAt: number | null = null;
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

      if (log?.status === 'SUGGESTED') {
        return { conversationId: conversation.id, mode: 'SUGGESTION' as const, suggestion: log, message: null };
      }
      if (log?.status === 'SIMULATED') {
        logSeenAt ??= Date.now();
        if (outboundMessage || Date.now() - logSeenAt >= SIMULATED_MESSAGE_GRACE_MS) {
          return { conversationId: conversation.id, mode: 'SIMULATED' as const, suggestion: log, message: outboundMessage };
        }
      } else if (log) {
        // Impossible for a simulated contact. If it ever happens something real may have been sent: say so, loudly.
        this.logger.error(`AI Test Chat: interaction log ${log.id} has status ${log.status} for a simulated conversation (${conversation.id})`);
        return {
          conversationId: conversation.id, mode: 'ERROR' as const, suggestion: log, message: outboundMessage,
          note: `Unexpected status ${log.status} in a simulated conversation. Please report this: nothing should be sent from the test chat.`,
        };
      } else if (outboundMessage) {
        if (isSimulatedMessage(outboundMessage)) {
          // A welcome message, a chatbot-flow step or the provider-failure apology: stored, never delivered.
          return { conversationId: conversation.id, mode: 'SIMULATED' as const, suggestion: null, message: outboundMessage };
        }
        this.logger.error(`AI Test Chat: outbound message ${outboundMessage.id} in simulated conversation ${conversation.id} is not marked simulated`);
        return {
          conversationId: conversation.id, mode: 'ERROR' as const, suggestion: null, message: outboundMessage,
          note: 'An outbound message in the test chat is not marked as simulated. Please report this: nothing should be sent from the test chat.',
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
