import { Injectable, Logger } from '@nestjs/common';
import { AiTrainingExample, FailureCategory, Prisma, TrainingExampleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { DIGITAL_SELF_FLAG_KEY } from './digital-self-learning.trigger';
import { CORRECTION_SOURCE, CORRECTION_WEIGHT, lockConversationAndReadExclusion, lockDigitalSelf, rebuildFromEvents } from './evidence.util';
import { extractFeatures } from './message-features.util';
import { deriveStatus, mergeFeatures, parseProfile } from './profile.util';

/**
 * The only failure categories that describe HOW a reply sounded rather than WHAT it said or did. Everything else (wrong price, wrong
 * product, lost context, a false claim, a bad handoff...) is a business or behaviour problem and stays in the reviewed-guidance
 * system. An example that mixes a style category with any other is ambiguous and is NOT applied to a Digital Self.
 */
export const STYLE_CATEGORIES: readonly FailureCategory[] = [FailureCategory.ROBOTIC_RESPONSE, FailureCategory.TOO_VERBOSE, FailureCategory.TOO_SHORT];

export const correctionKey = (exampleId: string): string => `correction:${exampleId}`;

export function isStyleCorrection(example: Pick<AiTrainingExample, 'failureCategories' | 'expectedResponse'>): boolean {
  return (
    example.failureCategories.length > 0 &&
    example.failureCategories.every((c) => STYLE_CATEGORIES.includes(c)) &&
    !!example.expectedResponse?.trim()
  );
}

export type CorrectionOutcome = 'applied' | 'unchanged' | 'removed' | 'not_a_style_correction' | 'no_digital_self' | 'excluded' | 'disabled' | 'missing';

/**
 * Connects the existing correction approval workflow to Digital Self, for communication style only. An example that a reviewer has
 * APPROVED, whose categories are all style categories, and whose conversation has a Digital Self assigned, contributes ONE weighted
 * sample (the numbers extracted from its corrected reply, never the text) to THAT agent's profile and to nobody else's. A
 * correction never creates evidence on its own: traits are still only reported once the agent's own replies reach the minimum.
 * Withdrawing the approval, changing the example, or excluding the conversation removes the sample exactly.
 */
@Injectable()
export class DigitalSelfCorrectionsService {
  private readonly logger = new Logger(DigitalSelfCorrectionsService.name);

  constructor(
    private prisma: PrismaService,
    private featureFlags: FeatureFlagsService,
  ) {}

  /** Idempotent. Call after an example's status or content changes. */
  async sync(tenantId: string, exampleId: string, actorId: string | null): Promise<CorrectionOutcome> {
    if (!(await this.featureFlags.isEnabledCached(DIGITAL_SELF_FLAG_KEY, tenantId))) return 'disabled';
    const example = await this.prisma.aiTrainingExample.findFirst({ where: { id: exampleId, tenantId } });
    if (!example) return 'missing';
    const existing = await this.prisma.digitalSelfLearningEvent.findFirst({ where: { tenantId, messageId: correctionKey(exampleId) } });

    if (example.status !== TrainingExampleStatus.APPROVED || !isStyleCorrection(example)) {
      return (await this.withdraw(tenantId, example, existing, actorId)) ? 'removed' : 'not_a_style_correction';
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: example.sourceConversationId, tenantId },
      select: { digitalSelfId: true, digitalSelfLearningExcluded: true },
    });
    if (!conversation?.digitalSelfId) { await this.withdraw(tenantId, example, existing, actorId); return 'no_digital_self'; }
    if (conversation.digitalSelfLearningExcluded) { await this.withdraw(tenantId, example, existing, actorId); return 'excluded'; }
    const self = await this.prisma.digitalSelf.findFirst({ where: { id: conversation.digitalSelfId, tenantId, enabled: true }, select: { id: true } });
    if (!self) { await this.withdraw(tenantId, example, existing, actorId); return 'no_digital_self'; }

    if (existing?.digitalSelfId === self.id) return 'unchanged';
    if (existing) await this.withdraw(tenantId, example, existing, actorId); // it moved to a different agent
    const features = extractFeatures(example.expectedResponse ?? '');
    if (!features) return 'not_a_style_correction';

    const outcome = await this.prisma.$transaction(async (tx): Promise<'applied' | 'excluded' | 'unchanged'> => {
      if (await lockConversationAndReadExclusion(tx, tenantId, example.sourceConversationId)) return 'excluded';
      await lockDigitalSelf(tx, self.id);
      if (await tx.digitalSelfLearningEvent.findUnique({ where: { messageId: correctionKey(exampleId) }, select: { id: true } })) return 'unchanged';
      const current = await tx.digitalSelf.findUniqueOrThrow({ where: { id: self.id } });
      await tx.digitalSelfLearningEvent.create({
        data: { tenantId, digitalSelfId: self.id, messageId: correctionKey(exampleId), source: CORRECTION_SOURCE, conversationId: example.sourceConversationId, features: features as unknown as Prisma.InputJsonValue, weight: CORRECTION_WEIGHT },
      });
      await tx.digitalSelf.update({
        where: { id: self.id },
        data: {
          profile: mergeFeatures(parseProfile(current.profile), [{ features, weight: CORRECTION_WEIGHT, correction: true }]) as unknown as Prisma.InputJsonValue,
          profileVersion: { increment: 1 },
          status: deriveStatus({ evidenceCount: current.evidenceCount, enabled: current.enabled, learningPaused: current.learningPaused, lastLearnedAt: current.lastLearnedAt }),
        },
      });
      await tx.aiTrainingExample.updateMany({ where: { id: exampleId, tenantId }, data: { digitalSelfId: self.id } });
      return 'applied';
    });
    if (outcome === 'applied') await this.audit(tenantId, actorId, 'digital_self.style_correction_applied', exampleId, { digitalSelfId: self.id });
    return outcome;
  }

  /** Removes the example's contribution (if any) and returns it to ordinary workspace guidance. True if a contribution was removed. */
  private async withdraw(tenantId: string, example: AiTrainingExample, existing: { id: string; digitalSelfId: string } | null, actorId: string | null): Promise<boolean> {
    if (existing) {
      await this.prisma.$transaction(async (tx) => {
        await lockDigitalSelf(tx, existing.digitalSelfId);
        const deleted = await tx.digitalSelfLearningEvent.deleteMany({ where: { id: existing.id, tenantId } });
        if (deleted.count > 0) await rebuildFromEvents(tx, tenantId, existing.digitalSelfId);
      });
      await this.audit(tenantId, actorId, 'digital_self.style_correction_removed', example.id, { digitalSelfId: existing.digitalSelfId });
    }
    if (example.digitalSelfId) await this.prisma.aiTrainingExample.updateMany({ where: { id: example.id, tenantId }, data: { digitalSelfId: null } });
    return !!existing;
  }

  private async audit(tenantId: string, actorId: string | null, action: string, exampleId: string, state: Record<string, unknown>): Promise<void> {
    await this.prisma.aiLearningAuditLog
      .create({ data: { tenantId, actorId: actorId ?? undefined, action, targetType: 'training_example', targetId: exampleId, newState: state as Prisma.InputJsonValue } })
      .catch((err: unknown) => this.logger.warn(`Could not write the Digital Self correction audit entry: ${err instanceof Error ? err.name : 'unknown'}`));
  }
}
