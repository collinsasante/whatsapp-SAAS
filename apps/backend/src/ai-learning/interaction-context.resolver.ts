import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedInteractionContext {
  conversationId: string;
  contactId: string | null;
  customerMessage: string;
  aiResponse: string;
  /** Last few turns before this one, oldest first -- kept short deliberately
   * (spec section 16: "do not dump unnecessary unrelated conversation history"). */
  priorContext: { direction: string; content: string | null; createdAt: Date }[];
  /** Real Order status closest to this turn, if this conversation has an order. */
  latestOrderStatus: string | null;
  /** Whether a real InternalTask already exists for this conversation (handoff signal). */
  handoffTaskExists: boolean;
  /** Whether the conversation is currently owned by a non-AI human agent. */
  humanOwned: boolean;
  conversationStatus: string;
}

const PRIOR_CONTEXT_TURNS = 6;

@Injectable()
export class InteractionContextResolver {
  constructor(private prisma: PrismaService) {}

  /** Returns null when the execution has no linked AiInteractionLog yet (e.g.
   * a race where evaluation runs before messages.service.ts finishes linking
   * it) -- the caller should retry rather than treat this as a hard failure. */
  async resolve(tenantId: string, aiExecutionId: string): Promise<ResolvedInteractionContext | null> {
    const execution = await this.prisma.aiExecution.findFirst({
      where: { id: aiExecutionId, tenantId },
      select: { conversationId: true, interactionLogId: true, createdAt: true },
    });
    if (!execution?.conversationId || !execution.interactionLogId) return null;

    const log = await this.prisma.aiInteractionLog.findFirst({
      where: { id: execution.interactionLogId, tenantId },
      select: { customerMessage: true, aiResponse: true, contactId: true },
    });
    if (!log) return null;

    const [conversation, priorMessages, latestOrder, handoffTask] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: execution.conversationId, tenantId },
        select: { status: true, assignedTo: { select: { isAiAgent: true } } },
      }),
      this.prisma.message.findMany({
        where: { tenantId, conversationId: execution.conversationId, createdAt: { lt: execution.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: PRIOR_CONTEXT_TURNS,
        select: { direction: true, content: true, createdAt: true },
      }),
      this.prisma.order.findFirst({
        where: { tenantId, conversationId: execution.conversationId },
        orderBy: { updatedAt: 'desc' },
        select: { status: true },
      }),
      this.prisma.internalTask.findFirst({
        where: { tenantId, conversationId: execution.conversationId },
        select: { id: true },
      }),
    ]);
    if (!conversation) return null;

    return {
      conversationId: execution.conversationId,
      contactId: log.contactId,
      customerMessage: log.customerMessage,
      aiResponse: log.aiResponse,
      priorContext: priorMessages.reverse(),
      latestOrderStatus: latestOrder?.status ?? null,
      handoffTaskExists: !!handoffTask,
      humanOwned: !!conversation.assignedTo && conversation.assignedTo.isAiAgent === false,
      conversationStatus: conversation.status,
    };
  }
}
