import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AiInteractionEvalJob, QueueName } from '@whatsapp-platform/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { lockDigitalSelf, rebuildFromEvents } from '../digital-self/evidence.util';
import { evalJobId } from './ai-learning-trigger.service';

const BATCH = 500;
/** Longest list of example ids kept on an audit row; the full count is always recorded. */
const MAX_AUDITED_IDS = 200;

/** Transaction settings for a deletion that erases learning data with it: more rows than a normal request, so a longer limit. */
export const ERASURE_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export interface ErasureSummary {
  conversations: number;
  interactionLogs: number;
  evaluations: number;
  trainingExamples: number;
  approvedExampleIds: string[];
  digitalSelfEvents: number;
  digitalSelvesRebuilt: number;
  executionsScrubbed: number;
  reviewTasks: number;
  /** Executions of the deleted conversations; used after commit to drop pending evaluation jobs. */
  executionIds: string[];
}

const EMPTY: ErasureSummary = {
  conversations: 0, interactionLogs: 0, evaluations: 0, trainingExamples: 0, approvedExampleIds: [],
  digitalSelfEvents: 0, digitalSelvesRebuilt: 0, executionsScrubbed: 0, reviewTasks: 0, executionIds: [],
};

function chunks<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Erases everything the AI Learning system derived from a conversation's customer text, INSIDE the transaction that deletes the
 * conversation, so the two succeed or fail together. A failure anywhere in here throws and the caller's deletion rolls back: customer
 * data is never deleted while learning copies of it remain.
 *
 * What is erased (all scoped to the tenant):
 *  - AiInteractionLog (customer message + AI reply), AiInteractionEvaluation and its feedback / customer corrections,
 *    every AiTrainingExample from the conversation (approved ones included; their ids and the count are audited, never their text);
 *  - Digital Self learning events from the conversation, after which each affected profile is REBUILT from the events that remain;
 *  - the conversation-linked 'ai_review' tasks (their description quotes the evaluator's reasoning);
 *  - AiExecution.toolTrace / errorMessage / interactionLogId for the conversation's executions. The execution rows themselves stay: they
 *    carry only usage metrics (tokens, cost, latency, status) that the platform needs for billing and capacity.
 * What is NOT touched: the AiLearningUsage cost ledger (no customer text), AI credits, and rows that already orphan (historical orphan
 * clean-up is a separate, operator-approved step).
 *
 * Locking: the conversations are locked FOR UPDATE first (ordered, so concurrent deletions cannot deadlock). A Digital Self learner or a
 * correction takes the same row FOR SHARE, so an in-flight learner finishes before the erasure looks, and a later one sees nothing to
 * learn from. The Digital Self rows are then locked in id order, matching the lock order the learner already uses (conversation, then
 * Digital Self).
 */
@Injectable()
export class LearningErasureService {
  private readonly logger = new Logger(LearningErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() @InjectQueue(QueueName.AI_INTERACTION_EVAL) private readonly evalQueue?: Queue<AiInteractionEvalJob>,
  ) {}

  /** `target` identifies what the user deleted (a conversation or a contact) for the audit row. */
  async eraseInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    conversationIds: readonly string[],
    actorId: string | null,
    target: { type: 'conversation' | 'contact'; id: string },
  ): Promise<ErasureSummary> {
    const ids = [...new Set(conversationIds)].sort();
    if (ids.length === 0) return { ...EMPTY };

    // 1. Lock, and prove every id belongs to this tenant (a mismatch aborts: never erase on another workspace's behalf).
    let locked = 0;
    for (const part of chunks(ids)) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM conversations WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(part)}) ORDER BY id FOR UPDATE`);
      locked += rows.length;
    }
    if (locked !== ids.length) throw new Error('Learning erasure refused: some conversations do not belong to this workspace.');

    const summary: ErasureSummary = { ...EMPTY, conversations: ids.length, approvedExampleIds: [], executionIds: [] };
    const inIds = { in: ids };

    // 2. Executions: keep the metrics, drop the free text.
    for (const part of chunks(ids)) {
      const executions = await tx.aiExecution.findMany({ where: { tenantId, conversationId: { in: part } }, select: { id: true } });
      summary.executionIds.push(...executions.map((e) => e.id));
      const scrubbed = await tx.aiExecution.updateMany({
        where: { tenantId, conversationId: { in: part } },
        data: { toolTrace: Prisma.DbNull, errorMessage: null, interactionLogId: null },
      });
      summary.executionsScrubbed += scrubbed.count;
    }

    // 3. Conversation-linked review tasks (the task text quotes the evaluator's reasoning about the customer's messages).
    for (const part of chunks(ids)) {
      summary.reviewTasks += (await tx.internalTask.deleteMany({ where: { tenantId, department: 'ai_review', conversationId: { in: part } } })).count;
    }

    // 4. Digital Self: lock every affected profile (id order), delete the conversation's events, rebuild from what remains.
    const affected = await tx.digitalSelfLearningEvent.findMany({ where: { tenantId, conversationId: inIds }, distinct: ['digitalSelfId'], select: { digitalSelfId: true } });
    const selfIds = affected.map((a) => a.digitalSelfId).sort();
    for (const id of selfIds) await lockDigitalSelf(tx, id);
    for (const part of chunks(ids)) {
      summary.digitalSelfEvents += (await tx.digitalSelfLearningEvent.deleteMany({ where: { tenantId, conversationId: { in: part } } })).count;
    }
    for (const id of selfIds) await rebuildFromEvents(tx, tenantId, id);
    summary.digitalSelvesRebuilt = selfIds.length;

    // 5. Training examples (approved ones are audited by id), evaluations (cascade to feedback and customer corrections), logs.
    for (const part of chunks(ids)) {
      const examples = await tx.aiTrainingExample.findMany({ where: { tenantId, sourceConversationId: { in: part } }, select: { id: true, status: true } });
      summary.approvedExampleIds.push(...examples.filter((e) => e.status === 'APPROVED').map((e) => e.id));
      summary.trainingExamples += (await tx.aiTrainingExample.deleteMany({ where: { tenantId, sourceConversationId: { in: part } } })).count;
      summary.evaluations += (await tx.aiInteractionEvaluation.deleteMany({ where: { tenantId, conversationId: { in: part } } })).count;
      summary.interactionLogs += (await tx.aiInteractionLog.deleteMany({ where: { tenantId, conversationId: { in: part } } })).count;
    }

    // 6. Audit: identifiers and counts only, never text. Written in the same transaction, so a rolled-back deletion leaves no audit row.
    const touched = summary.interactionLogs + summary.evaluations + summary.trainingExamples + summary.digitalSelfEvents + summary.executionsScrubbed + summary.reviewTasks;
    if (touched > 0) {
      await tx.aiLearningAuditLog.create({
        data: {
          tenantId, actorId, action: 'learning.erased_for_deletion', targetType: target.type, targetId: target.id,
          previousState: {
            conversations: summary.conversations, interactionLogs: summary.interactionLogs, evaluations: summary.evaluations, trainingExamples: summary.trainingExamples,
            approvedExamples: summary.approvedExampleIds.length, approvedExampleIds: summary.approvedExampleIds.slice(0, MAX_AUDITED_IDS),
            digitalSelfEvents: summary.digitalSelfEvents, digitalSelvesRebuilt: summary.digitalSelvesRebuilt, executionsScrubbed: summary.executionsScrubbed, reviewTasks: summary.reviewTasks,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return summary;
  }

  /**
   * After the deletion has COMMITTED: drop queued evaluation jobs for the deleted conversations and tell the workspace admins if approved
   * examples were removed. Best effort and never throws: correctness does not depend on it. The processor re-checks that the conversation
   * still exists before any provider call, and the evaluation's own foreign key rejects a late write.
   */
  async afterCommit(tenantId: string, summary: ErasureSummary): Promise<void> {
    await this.dropPendingJobs(summary.executionIds);
    if (summary.approvedExampleIds.length === 0) return;
    try {
      const admins = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, select: { id: true } });
      const count = summary.approvedExampleIds.length;
      await Promise.all(admins.map((a) => this.notifications.notifyUser(a.id, tenantId, {
        type: 'SYSTEM',
        title: 'Approved AI training examples were removed',
        body: `Deleting customer data removed ${count} approved AI training example${count === 1 ? '' : 's'} that came from it. They no longer affect AI replies.`,
        link: '/ai/learning',
      })));
    } catch (err) {
      this.logger.warn(`Could not notify admins of ${summary.approvedExampleIds.length} removed approved examples for tenant ${tenantId}: ${String(err)}`);
    }
  }

  private async dropPendingJobs(executionIds: readonly string[]): Promise<void> {
    if (!this.evalQueue || executionIds.length === 0) return;
    for (const part of chunks(executionIds, 50)) {
      await Promise.all(part.map(async (executionId) => {
        try {
          await this.evalQueue!.remove(evalJobId(executionId));
        } catch (err) {
          // A job that is running right now cannot be removed (it holds its lock); the processor's own checks cover it.
          this.logger.debug(`Evaluation job for execution ${executionId} not removed: ${String(err)}`);
        }
      }));
    }
  }
}
