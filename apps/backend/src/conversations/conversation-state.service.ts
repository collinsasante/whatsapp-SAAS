import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiState, mergeAiState } from '../ai-core/tools/state-derivation.util';

/**
 * Verz-AI unification, Phase F: reads/writes Conversation.aiState. Kept as a
 * thin, isolated service (not folded into ConversationsService) so both AI
 * orchestrators (Commerce, the v2 pipeline) and their tools can depend on it
 * without pulling in ConversationsService's much larger surface (assignment,
 * SLA, notifications, etc.) -- this only ever touches one JSON column.
 */
@Injectable()
export class ConversationStateService {
  private readonly logger = new Logger(ConversationStateService.name);

  constructor(private prisma: PrismaService) {}

  async getState(tenantId: string, conversationId: string): Promise<AiState | null> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { aiState: true },
    });
    return (row?.aiState as AiState | null) ?? null;
  }

  /** Never throws -- state tracking must not break the conversation it's observing. */
  async mergeState(tenantId: string, conversationId: string, patch: Partial<AiState>): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    try {
      const existing = await this.getState(tenantId, conversationId);
      const merged = mergeAiState(existing, patch);
      await this.prisma.conversation.updateMany({
        where: { id: conversationId, tenantId },
        data: { aiState: merged as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.warn(`Failed to merge AI state for conversation ${conversationId}: ${String(err)}`);
    }
  }
}
