import { Inject, Injectable, Optional } from '@nestjs/common';
import { DigitalSelfContextService } from '../../../digital-self/digital-self-context.service';

import { PrismaService } from '../../../prisma/prisma.service';
import { ConversationStateService } from '../../../conversations/conversation-state.service';
import { PipelineContext, PipelineStage } from '../pipeline.types';
import { KNOWLEDGE_CONTEXT_SOURCE, KnowledgeContextSource } from '../knowledge-context.source';
import { buildConversationHistoryWhere } from '../../context/history-scope.util';
import { loadHistory } from '../../context/history-loader.util';

const HISTORY_WINDOW = 12;

/**
 * Ported verbatim from the legacy responder: last-12 TEXT-message window,
 * menu-digit expansion, then relevance-filtered KB context keyed off the
 * (possibly menu-expanded) final customer message -- same ordering, same
 * behavior. businessName is tenant-level (TenantSettings), not agent-level;
 * personality/systemInstructions are already on ctx, seeded by the pipeline
 * from the resolved AiAgent before stages run.
 *
 * History is the current conversation only, and always tenant-scoped
 * (buildConversationHistoryWhere) -- the message query previously filtered by
 * conversationId alone.
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

    const historyWhere = buildConversationHistoryWhere(ctx.input.tenantId, ctx.input.conversationId);

    const [settings, history, conversation, aiState] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId: ctx.input.tenantId },
        select: { businessName: true, businessAddress: true, businessPhone: true, offHoursSchedule: true, timezone: true },
      }),
      // A blank conversation id => empty history, never an unscoped query.
      loadHistory(this.prisma, historyWhere, HISTORY_WINDOW, ctx.input.currentMessageId),
      this.prisma.conversation.findFirst({
        where: { id: ctx.input.conversationId, tenantId: ctx.input.tenantId },
        select: { adSourceId: true, adHeadline: true, adImageUrl: true },
      }),
      this.conversationState.getState(ctx.input.tenantId, ctx.input.conversationId),
    ]);

    ctx.businessName = settings?.businessName ?? 'our business';
    ctx.businessInfo = settings ?? undefined;
    ctx.adContext = conversation ?? undefined;
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

    ctx.knowledgeContext = await this.knowledgeContext.getContext(ctx.input.tenantId, ctx.customerMessage, history.customerMessages);
    // Rides in the same template variable as the KB, so no stored prompt template has to change; '' when no Digital Self applies.
    ctx.knowledgeContext += (await this.digitalSelfContext?.getStyleBlock(ctx.input.tenantId, ctx.input.conversationId)) ?? '';

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
