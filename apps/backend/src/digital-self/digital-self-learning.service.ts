import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { provisionDigitalSelf } from './digital-self.service';
import { extractFeatures, isEligibleHumanMessage } from './message-features.util';
import { deriveStatus, mergeFeatures, parseProfile } from './profile.util';
import { lockConversationAndReadExclusion, lockDigitalSelf, REPLY_SOURCE } from './evidence.util';
import { matchesSavedReply, templateBodyText } from './saved-reply.util';

export type LearnOutcome = 'learned' | 'duplicate' | 'ineligible' | 'paused' | 'excluded';

/** How many saved replies / templates are compared against; a workspace with more than this has its newest ones checked. */
const MAX_SAVED_TEXTS = 500;

/**
 * Incremental, idempotent learning from ONE human-agent reply. Never called on the customer reply path: the processor runs it
 * after the fact. The dedupe ledger row and the profile update commit together under a row lock on the agent's Digital Self, so a
 * redelivered job, a retry, or two replies processed at once can neither double-count nor lose an update, and a failure part-way
 * leaves the previous profile untouched. The conversation's exclusion flag is read under a shared lock on the conversation row, so
 * a conversation excluded while this runs cannot slip evidence in behind the removal (see lockConversationAndReadExclusion).
 */
@Injectable()
export class DigitalSelfLearningService {
  private readonly logger = new Logger(DigitalSelfLearningService.name);

  constructor(private prisma: PrismaService) {}

  async learnFromMessage(tenantId: string, messageId: string): Promise<LearnOutcome> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      select: {
        tenantId: true, conversationId: true, direction: true, type: true, senderId: true, templateId: true, content: true, metadata: true,
        sender: { select: { isAiAgent: true } },
        conversation: { select: { digitalSelfLearningExcluded: true } },
      },
    });
    if (!msg?.senderId) return 'ineligible';
    // Cheap early exit; the authoritative check is repeated under lock below.
    if (msg.conversation.digitalSelfLearningExcluded) return 'excluded';
    if (!isEligibleHumanMessage({ ...msg, senderIsAiAgent: msg.sender?.isAiAgent ?? null }, tenantId, msg.senderId)) return 'ineligible';

    const self = await provisionDigitalSelf(this.prisma, tenantId, msg.senderId);
    if (!self) return 'ineligible';
    if (!self.enabled || self.learningPaused) return 'paused';

    const text = msg.content ?? '';
    if (await this.isSavedText(tenantId, text)) return 'ineligible';
    const features = extractFeatures(text);
    if (!features) return 'ineligible';

    return this.prisma.$transaction(async (tx) => {
      if (await lockConversationAndReadExclusion(tx, tenantId, msg.conversationId)) return 'excluded' as const;
      await lockDigitalSelf(tx, self.id);
      if (await tx.digitalSelfLearningEvent.findUnique({ where: { messageId }, select: { id: true } })) return 'duplicate' as const;

      const current = await tx.digitalSelf.findUniqueOrThrow({ where: { id: self.id } });
      if (!current.enabled || current.learningPaused) return 'paused' as const;
      const evidenceCount = current.evidenceCount + 1;
      const now = new Date();

      await tx.digitalSelfLearningEvent.create({
        data: { tenantId, digitalSelfId: self.id, messageId, source: REPLY_SOURCE, conversationId: msg.conversationId, features: features as unknown as Prisma.InputJsonValue, weight: 1 },
      });
      await tx.digitalSelf.update({
        where: { id: self.id },
        data: {
          profile: mergeFeatures(parseProfile(current.profile), [features]) as unknown as Prisma.InputJsonValue,
          profileVersion: { increment: 1 },
          evidenceCount,
          lastLearnedAt: now,
          lastError: null,
          status: deriveStatus({ evidenceCount, enabled: current.enabled, learningPaused: current.learningPaused, lastLearnedAt: now }, now),
        },
      });
      return 'learned' as const;
    });
  }

  /** True when the text is one of the workspace's saved replies or template bodies, with or without variables filled in. */
  private async isSavedText(tenantId: string, text: string): Promise<boolean> {
    const [canned, templates] = await Promise.all([
      this.prisma.cannedResponse.findMany({ where: { tenantId }, select: { content: true }, orderBy: { updatedAt: 'desc' }, take: MAX_SAVED_TEXTS }),
      this.prisma.template.findMany({ where: { tenantId }, select: { components: true }, orderBy: { updatedAt: 'desc' }, take: MAX_SAVED_TEXTS }),
    ]);
    const known = [...canned.map((c) => c.content), ...templates.map((t) => templateBodyText(t.components)).filter((t): t is string => !!t)];
    return matchesSavedReply(text, known);
  }

  /** Records that learning failed, without any message content, so the profile view can show it. The profile itself is not touched. */
  async recordFailure(tenantId: string, messageId: string, error: unknown): Promise<void> {
    const reason = (error instanceof Error ? error.name : 'Error').slice(0, 80);
    try {
      const msg = await this.prisma.message.findFirst({ where: { id: messageId, tenantId }, select: { senderId: true } });
      if (!msg?.senderId) return;
      await this.prisma.digitalSelf.updateMany({ where: { tenantId, userId: msg.senderId }, data: { lastError: `learning failed: ${reason}` } });
    } catch (err) {
      this.logger.warn(`Could not record a Digital Self learning failure: ${err instanceof Error ? err.name : 'unknown'}`);
    }
  }
}
