import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationStateService } from '../../conversations/conversation-state.service';
import { sanitizeForWhatsApp } from '../../ai-core/pipeline/whatsapp-format.util';
import { detectHumanRequest } from '../../ai-core/pipeline/escalation-detector.util';
import { detectInjection } from '../../ai-core/guards/injection-patterns';
import { ToolCallingService, ToolCallTrace } from '../../ai-core/tools/tool-calling.service';
import { ToolSideEffect } from '../../ai-core/tools/tool-registry.types';
import { deriveStateFromToolTrace } from '../../ai-core/tools/state-derivation.util';
import { ChatMessage } from '../../ai-core/providers/ai-provider.interface';
import { buildIdentityAndSafetyBlock } from '../../ai-core/prompts/shared-identity-block';
import { SHARED_STYLE_RULES } from '../../ai-core/prompts/shared-style-rules';
import { formatBusinessInfoBlock } from '../../ai-core/prompts/business-info.util';
import { formatStateBlock } from '../../ai-core/prompts/conversation-state.util';
import { DEEPSEEK_MODEL } from '../../common/deepseek';

/**
 * Managed Commerce's AI sales assistant. Verz-AI unification, Phase A: this
 * service no longer owns its own DeepSeek call, tool loop, or injection-pattern
 * list -- all of that moved to the shared ai-core infrastructure
 * (ToolCallingService + ToolRegistryService + the canonical injection guard) so
 * commerce gets the same provider abstraction, tracing, cost estimation, and
 * security defense as every other AI capability on the platform. This file now
 * owns only what's genuinely commerce-specific: the system prompt, knowledge/
 * history context assembly, and human-escalation detection.
 *
 * Still true, unchanged: this service has no dependency on CommerceLedgerService
 * and none of its tools can set Order.status = PAID -- that transition exists in
 * exactly one place (CommerceLedgerService.recordPaymentSuccess), reachable only
 * from CommerceWebhookController after a gateway-verified payment.
 */

const COMMERCE_TOOL_NAMES = [
  'search_products',
  'get_product_details',
  'add_item_to_order',
  'get_current_order',
  'submit_order_for_payment',
  'get_order_status',
  'create_internal_task',
  'qualify_lead',
  'send_product_image',
  'remember_conversation_facts',
];

/** Verz-AI unification, Phase C: offered instead of COMMERCE_TOOL_NAMES when the
 * caller is running this in SUGGESTION mode -- Commerce has never run in
 * SUGGESTION mode before, so a human hasn't approved anything yet;
 * order/task-mutating tools stay withheld until AUTO_REPLY or a human sends.
 * send_product_image is withheld too -- it has a real customer-visible side
 * effect (sending a WhatsApp media message), same category as add_item_to_order.
 * remember_conversation_facts has no customer-visible effect, so it's included. */
const READ_ONLY_COMMERCE_TOOL_NAMES = [
  'search_products',
  'get_product_details',
  'get_current_order',
  'get_order_status',
  'qualify_lead',
  'remember_conversation_facts',
];

export interface CommerceAiResult {
  response: string;
  blocked: boolean;
  /** Populated unconditionally; only consumed by the AI evaluation harness today
   * (e.g. to verify get_order_status was actually invoked before a payment claim).
   * messages.service.ts destructures only response/blocked, so this is additive. */
  toolTrace?: ToolCallTrace[];
  /** Verz-AI unification, Phase G: side effects (e.g. send_product_image) a tool
   * call this turn triggered -- the caller is responsible for actually delivering
   * them (see MessagesService.deliverMedia). */
  mediaToSend?: ToolSideEffect[];
}

@Injectable()
export class CommerceAiService {
  private readonly logger = new Logger(CommerceAiService.name);

  constructor(
    private prisma: PrismaService,
    private knowledgeBase: KnowledgeBaseService,
    private conversations: ConversationsService,
    private conversationState: ConversationStateService,
    private toolCalling: ToolCallingService,
  ) {}

  async handleMessage(
    tenantId: string,
    conversationId: string,
    contactId: string,
    customerPhone: string,
    customerMessage: string,
    contactName?: string,
    evalContext?: { dryRunPayment: boolean },
    opts?: { readOnlyTools?: boolean },
  ): Promise<CommerceAiResult> {
    if (detectInjection(customerMessage)) {
      return { response: "I'm here to help you shop. How can I assist you today?", blocked: true, toolTrace: [] };
    }

    if (!process.env.DEEPSEEK_API_KEY) return { response: '', blocked: false, toolTrace: [] };

    // Unlike the general pipeline's EscalationStage, this path previously had no
    // escalation mechanism at all -- the model would tell the customer "a team member
    // will reach out" while nothing actually happened (no status change, no
    // notification). Same detector the general pipeline uses; runs before generation
    // so the AI's own reply and the real status change happen together.
    if (detectHumanRequest(customerMessage)) {
      await this.conversations
        .request(tenantId, conversationId, 'Commerce AI escalation: customer asked to speak with a human')
        .catch((err) => this.logger.warn(`Commerce AI: failed to escalate conversation ${conversationId}: ${String(err)}`));
    }

    const [settings, conversation, aiState] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { businessName: true, businessAddress: true, businessPhone: true, offHoursSchedule: true, timezone: true },
      }),
      this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { adSourceId: true, adHeadline: true, adImageUrl: true } }),
      this.conversationState.getState(tenantId, conversationId),
    ]);
    const businessName = settings?.businessName ?? 'our shop';

    // Non-product questions (hours, delivery policy, returns, etc.) live in the
    // general knowledge base, not the product catalogue -- without this the
    // commerce agent has no way to answer anything outside of search_products.
    const kbArticles = await this.knowledgeBase.getRelevant(tenantId, customerMessage).catch(() => []);
    const knowledgeContext = kbArticles.length === 0
      ? ''
      : '\n\nKNOWLEDGE BASE (for policies, hours, and other non-product questions -- product info still comes from the tools):\n' +
        kbArticles.map((a) => `## ${a.title}\n${a.content}`).join('\n\n');

    const history = await this.prisma.message.findMany({
      where: { conversationId, type: 'TEXT', content: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { direction: true, content: true },
    });

    const commerceRules = [
      `You are the AI sales assistant for ${businessName} on WhatsApp. You help customers browse products, build an order, and check out.`,
      ``,
      `COMMERCE RULES:`,
      `- Use ONLY tool results for product names, prices, and stock. Never invent or guess a price or say something is in stock without checking.`,
      `- Never state that a payment has succeeded, an order is paid, or money has been received unless get_order_status just told you so. If a customer says they paid, check with get_order_status before confirming anything.`,
      `- Whenever a customer asks about their order or payment status -- e.g. "did my order go through", "is it paid", "what's my order status" -- ALWAYS call get_order_status right away, even if they have not given you an order ID. It automatically looks up their most recent order in this conversation. Never guess, never ask a clarifying question first when you could just check.`,
      `- Never issue a refund, discount, or price override -- you have no tool for it, so if asked, say a team member will help with that.`,
      `- If the knowledge base lists more than one design-related price (e.g. a logo design vs. a label/print design), treat them as separate services with separate prices. Never combine, average, or confuse them -- always be clear which specific service a price applies to.`,
      `- When the customer is ready to buy, add items with add_item_to_order, confirm the order with get_current_order, then only call submit_order_for_payment once they explicitly say to check out. Give them the payment link exactly as returned.`,
      `- If a customer needs something a team member has to handle -- forwarding artwork, a special request, a complaint -- use create_internal_task rather than just saying someone will follow up. Tell the customer you've flagged it, briefly.`,
      `- If submit_order_for_payment returns status AWAITING_APPROVAL, tell the customer their order needs a quick review because of the quantity and you'll follow up once it's approved -- this is not a rejection, and there is no payment link yet.`,
      `- Call qualify_lead once the customer has given you enough to judge (a quantity, a deadline, a budget, or clear buying intent) -- not on every message. Its result is for your own judgement only; never repeat its score, status, or reasoning back to the customer.`,
      `- If the customer asks to see a product, wants a picture, or asks "where's the photo" -- check get_product_details for hasImage, then call send_product_image if one exists. If there's no image, say so honestly rather than pretending you sent one.`,
      `- Call remember_conversation_facts once you've learned something worth keeping (what they want, quantity, a deadline, a delivery area) so you don't have to ask again if the conversation wanders and comes back.`,
    ].join('\n');

    const systemPrompt = [
      commerceRules,
      ``,
      SHARED_STYLE_RULES,
      formatBusinessInfoBlock(settings ?? {}, conversation ?? undefined),
      formatStateBlock(aiState),
      ``,
      buildIdentityAndSafetyBlock(businessName),
    ].join('\n') + knowledgeContext;

    const historyMessages: ChatMessage[] = history.reverse().map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.content!,
    }));

    const userContent = contactName ? `Customer name: ${contactName}\nMessage: ${customerMessage}` : customerMessage;

    const result = await this.toolCalling.complete({
      tenantId,
      taskType: 'RESPONDER',
      conversationId,
      systemPrompt,
      // The last history entry is this same customerMessage, already persisted before
      // this call runs -- dropped here since userMessage below carries the properly
      // contactName-prefixed version instead, matching the pre-unification behavior.
      historyMessages: historyMessages.slice(0, -1),
      userMessage: userContent,
      toolNames: opts?.readOnlyTools ? READ_ONLY_COMMERCE_TOOL_NAMES : COMMERCE_TOOL_NAMES,
      toolContext: { tenantId, conversationId, contactId, customerPhone, dryRunPayment: evalContext?.dryRunPayment },
      modelKey: DEEPSEEK_MODEL,
      maxTokens: 900, // 500 was cutting off replies mid-sentence on longer, multi-item quotes
    });

    // Deterministic half of state tracking -- reads whatever tools actually ran this
    // turn (selected product, active order) regardless of what happens below.
    // Never throws; failure here must not affect the reply itself.
    void this.conversationState.mergeState(tenantId, conversationId, deriveStateFromToolTrace(result.toolTrace));

    if (result.failed) return { response: '', blocked: false, toolTrace: result.toolTrace };

    if (result.hitMaxIterations) {
      this.logger.warn(`Commerce AI hit max tool-call iterations for conversation ${conversationId}`);
      // Verz-AI unification, Phase I: previously this line said "let me get a team
      // member" without actually escalating -- no task, no notification, no status
      // change. Same real-escalation call detectHumanRequest already uses above.
      await this.conversations
        .request(tenantId, conversationId, 'Commerce AI escalation: hit max tool-call iterations without a final answer')
        .catch((err) => this.logger.warn(`Commerce AI: failed to escalate conversation ${conversationId} after hitting max iterations: ${String(err)}`));
      return { response: "Let me get a team member to help finish this up for you.", blocked: false, toolTrace: result.toolTrace };
    }

    const content = result.content.trim();
    if (!content) {
      this.logger.warn(`Commerce AI: empty content and no tool calls for conversation ${conversationId}`);
    }
    return {
      response: content ? sanitizeForWhatsApp(content) : content,
      blocked: false,
      toolTrace: result.toolTrace,
      mediaToSend: result.sideEffects,
    };
  }
}
