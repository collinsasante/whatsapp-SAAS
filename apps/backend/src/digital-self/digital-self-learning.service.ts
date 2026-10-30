import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { provisionDigitalSelf } from './digital-self.service';
import { extractFeatures, isEligibleHumanMessage } from './message-features.util';
import { deriveStatus, mergeFeatures, parseProfile } from './profile.util';

export type LearnOutcome = 'learned' | 'duplicate' | 'ineligible' | 'paused';

/**
 * Incremental, idempotent learning from ONE human-agent reply. Never called on the customer reply path: the processor runs it
 * after the fact. The dedupe ledger row and the profile update commit together under a row lock on the agent's Digital Self, so a
 * redelivered job, a retry, or two replies processed at once can neither double-count nor lose an update, and a failure part-way
 * leaves the previous profile untouched.
 */
@Injectable()
export class DigitalSelfLearningService {
  private readonly logger = new Logger(DigitalSelfLearningService.name);

  constructor(private prisma: PrismaService) {}

  async learnFromMessage(tenantId: string, messageId: string): Promise<LearnOutcome> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      select: { tenantId: true, direction: true, type: true, senderId: true, templateId: true, content: true, metadata: true, sender: { select: { isAiAgent: true } } },
    });
    if (!msg?.senderId) return 'ineligible';
    if (!isEligibleHumanMessage({ ...msg, senderIsAiAgent: msg.sender?.isAiAgent ?? null }, tenantId, msg.senderId)) return 'ineligible';

    const self = await provisionDigitalSelf(this.prisma, tenantId, msg.senderId);
    if (!self) return 'ineligible';
    if (!self.enabled || self.learningPaused) return 'paused';

    const text = msg.content ?? '';
    // A saved reply pasted verbatim is the business's wording, not the agent's own style.
    const canned = await this.prisma.cannedResponse.findFirst({ where: { tenantId, content: { in: [text, text.trim()] } }, select: { id: true } });
    if (canned) return 'ineligible';
    const features = extractFeatures(text);
    if (!features) return 'ineligible';

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM digital_selves WHERE id = ${self.id} FOR UPDATE`);
      if (await tx.digitalSelfLearningEvent.findUnique({ where: { messageId }, select: { id: true } })) return 'duplicate' as const;

      const current = await tx.digitalSelf.findUniqueOrThrow({ where: { id: self.id } });
      if (!current.enabled || current.learningPaused) return 'paused' as const;
      const evidenceCount = current.evidenceCount + 1;
      const now = new Date();

      await tx.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId } });
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
