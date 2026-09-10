import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConversationStateService } from '../../../conversations/conversation-state.service';
import { PipelineContext, PipelineStage } from '../pipeline.types';
import { KNOWLEDGE_CONTEXT_SOURCE, KnowledgeContextSource } from '../knowledge-context.source';

const HISTORY_WINDOW = 12;

/**
 * Ported verbatim from the legacy responder: last-12 TEXT-message window,
 * menu-digit expansion, then relevance-filtered KB context keyed off the
 * (possibly menu-expanded) final customer message -- same ordering, same
 * behavior. businessName is tenant-level (TenantSettings), not agent-level;
 * personality/systemInstructions are already on ctx, seeded by the pipeline
 * from the resolved AiAgent before stages run.
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
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    const [settings, history, conversation, aiState] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId: ctx.input.tenantId },
        select: { businessName: true, businessAddress: true, businessPhone: true, offHoursSchedule: true, timezone: true },
      }),
      this.prisma.message.findMany({
        where: { conversationId: ctx.input.conversationId, type: 'TEXT', content: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_WINDOW,
        select: { direction: true, content: true },
      }),
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
    const lastOutbound = history.find((m) => m.direction === 'OUTBOUND');
    const bare = ctx.customerMessage.trim();
    if (/^[123]$/.test(bare) && lastOutbound?.content) {
      const optLine = lastOutbound.content
        .split('\n')
        .find((l) => new RegExp(`^${bare}[.)\\s]`).test(l.trim()));
      if (optLine) {
        ctx.customerMessage = `I selected option ${bare}: ${optLine.replace(/^[123][.)]\s*/, '').trim()}`;
      }
    }

    // The current customer message is already persisted as the newest row in `history`
    // (the caller writes it before invoking the pipeline) -- drop it here since
    // GenerationStage re-appends it explicitly as the final user turn (with the
    // menu-expanded text and optional contactName prefix), matching the legacy
    // responder's `historyMessages.slice(0, -1)` + explicit final message.
    ctx.historyMessages = history
      .reverse()
      .map((m) => ({ role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const), content: m.content! }))
      .slice(0, -1);

    ctx.knowledgeContext = await this.knowledgeContext.getContext(ctx.input.tenantId, ctx.customerMessage);

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
