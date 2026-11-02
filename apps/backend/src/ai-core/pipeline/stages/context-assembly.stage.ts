import { Inject, Injectable, Optional } from '@nestjs/common';
import { DigitalSelfContextService } from '../../../digital-self/digital-self-context.service';

import { PrismaService } from '../../../prisma/prisma.service';
import { ConversationStateService } from '../../../conversations/conversation-state.service';
import { PipelineContext, PipelineStage } from '../pipeline.types';
import { KNOWLEDGE_CONTEXT_SOURCE, KnowledgeContextSource } from '../knowledge-context.source';
import { buildConversationHistoryWhere, buildHistoryWhere } from '../../context/history-scope.util';
import { loadHistory } from '../../context/history-loader.util';

/** Turns kept when the history follows the verified customer across their conversations (the legacy responder kept 200). */
const CUSTOMER_HISTORY_WINDOW = 40;
/** Turns kept inside the current conversation, the fallback when the customer cannot be verified. */
const CONVERSATION_HISTORY_WINDOW = 12;

/**
 * Ported from the legacy responder: a bounded TEXT-message window (40 turns for a verified customer, 12 in the current conversation),
 * menu-digit expansion, then relevance-filtered KB context keyed off the
 * (possibly menu-expanded) final customer message -- same ordering, same
 * behavior. businessName is tenant-level (TenantSettings), not agent-level;
 * personality/systemInstructions are already on ctx, seeded by the pipeline
 * from the resolved AiAgent before stages run.
 *
 * History is tenant-scoped and, like the legacy responder it replaces, follows the CUSTOMER: a returning contact's earlier
 * conversations with this tenant inform the reply (buildHistoryWhere, scoped by the verified contact id). If the conversation
 * or its contact cannot be verified it falls back to the current conversation only (buildConversationHistoryWhere), never wider.
 *
 * Verz-AI unification, Phase D/F: also fetches TenantSettings' business-data
 * fields (previously never read into any prompt), the conversation's ad
 * referral fields (real data from WhatsApp's Click-to-WhatsApp-Ads payload),
 * and the conversation's advisory aiState, so PromptBuildStage can ground the
 * reply in real business facts and cross-turn memory.
 */
@Injectable()
export class ContextAssemblyStage implements PipelineStage {
  readonly name = 'context_assembly';

  constructor(
    private prisma: PrismaService,
    private conversationState: ConversationStateService,
    @Inject(KNOWLEDGE_CONTEXT_SOURCE) private knowledgeContext: KnowledgeContextSource,
    @Optional() private digitalSelfContext?: DigitalSelfContextService,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    const [settings, conversation, aiState] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId: ctx.input.tenantId },
        select: { businessName: true, businessAddress: true, businessPhone: true, offHoursSchedule: true, timezone: true },
      }),
      this.prisma.conversation.findFirst({
        where: { id: ctx.input.conversationId, tenantId: ctx.input.tenantId },
        select: { adSourceId: true, adHeadline: true, adImageUrl: true, contactId: true },
      }),
      this.conversationState.getState(ctx.input.tenantId, ctx.input.conversationId),
    ]);

    // The verified contact id (from the tenant's own conversation row) widens the history to this customer's earlier chats;
    // without it the history stays inside the current conversation. A blank conversation id => empty history, never unscoped.
    // A blank contact id is not a verified one: it gets the narrow scope AND the narrow window (buildHistoryWhere itself also
    // falls back to the conversation for a blank id, so the two decisions cannot disagree).
    const contactId = conversation?.contactId && conversation.contactId.trim().length > 0 ? conversation.contactId : null;
    const verifiedContact = contactId !== null;
    const historyWhere = contactId !== null
      ? buildHistoryWhere(ctx.input.tenantId, { id: ctx.input.conversationId, contactId })
      : buildConversationHistoryWhere(ctx.input.tenantId, ctx.input.conversationId);
    const history = await loadHistory(this.prisma, historyWhere, verifiedContact ? CUSTOMER_HISTORY_WINDOW : CONVERSATION_HISTORY_WINDOW, ctx.input.currentMessageId);

    ctx.businessName = settings?.businessName ?? 'our business';
    ctx.businessInfo = settings ?? undefined;
    ctx.adContext = conversation ? { adSourceId: conversation.adSourceId, adHeadline: conversation.adHeadline, adImageUrl: conversation.adImageUrl } : undefined;
    ctx.conversationState = aiState;

    // Menu state: if the last outbound message was a numbered list and the customer
    // replied with a bare digit, expand it to the full option text so the LLM has context.
    const lastOutbound = history.lastOutbound;
    const bare = ctx.customerMessage.trim();
    if (/^[123]$/.test(bare) && lastOutbound) {
      const optLine = lastOutbound
        .split('\n')
        .find((l) => new RegExp(`^${bare}[.)\\s]`).test(l.trim()));
      if (optLine) {
        ctx.customerMessage = `I selected option ${bare}: ${optLine.replace(/^[123][.)]\s*/, '').trim()}`;
      }
    }

    // The history was selected around the stored inbound message (by id), so it never contains the message being
    // answered; GenerationStage appends that one explicitly as the final user turn (with the menu-expanded text and
    // optional contactName prefix).
    ctx.historyMessages = history.turns;

    if (this.knowledgeContext.getContextWithTrace) {
      const retrieved = await this.knowledgeContext.getContextWithTrace(ctx.input.tenantId, ctx.customerMessage, history.customerMessages);
      ctx.knowledgeContext = retrieved.context;
      ctx.retrievalTrace = retrieved.trace;
      ctx.trace.safetyFlags.retrieval = retrieved.trace; // recorded with the execution, so a reply can be traced to the articles behind it
    } else {
      ctx.knowledgeContext = await this.knowledgeContext.getContext(ctx.input.tenantId, ctx.customerMessage, history.customerMessages);
    }
    // Rides in the same template variable as the KB, so no stored prompt template has to change; '' when no Digital Self applies.
    ctx.knowledgeContext += (await this.digitalSelfContext?.getStyleBlock(ctx.input.tenantId, ctx.input.conversationId)) ?? '';

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
