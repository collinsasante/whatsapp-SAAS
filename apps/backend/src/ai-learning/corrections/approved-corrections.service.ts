import { Injectable, Logger } from '@nestjs/common';
import { TrainingExampleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatCorrectionsBlock, selectRelevantCorrections } from './correction-selection.util';

/** Newest approved examples considered per message. Selection happens in memory, so this bounds the work, not the quality. */
const CANDIDATE_LIMIT = 200;

/**
 * Supplies the "reviewed guidance" prompt block for one tenant and one customer message. Only that tenant's APPROVED training examples
 * are ever read. A failure here must never stop a reply, so every error ends as an empty block and a log line without message text.
 */
@Injectable()
export class ApprovedCorrectionsService {
  private readonly logger = new Logger(ApprovedCorrectionsService.name);

  constructor(private prisma: PrismaService) {}

  /** Off only when explicitly disabled, so a bad correction set can be switched off without a deploy of code. */
  isDisabled(): boolean {
    return process.env.AI_CORRECTIONS_DISABLED === 'true';
  }

  async getGuidanceBlock(tenantId: string, customerMessage: string): Promise<string> {
    if (this.isDisabled() || !tenantId || !customerMessage.trim()) return '';
    try {
      // Its own switch, independent of the learning opt-in/pause: guidance a workspace already approved keeps applying until it turns this off.
      const settings = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId }, select: { approvedGuidanceEnabled: true } });
      if (settings && !settings.approvedGuidanceEnabled) return '';
      const examples = await this.prisma.aiTrainingExample.findMany({
        // digitalSelfId null: a style correction applied to one agent's Digital Self must not also steer every other agent's replies.
        where: { tenantId, status: TrainingExampleStatus.APPROVED, digitalSelfId: null },
        orderBy: [{ approvedAt: 'desc' }, { updatedAt: 'desc' }],
        take: CANDIDATE_LIMIT,
        select: { id: true, customerInput: true, expectedAction: true, expectedResponse: true, approvedAt: true, updatedAt: true },
      });
      return formatCorrectionsBlock(selectRelevantCorrections(examples, customerMessage));
    } catch (err) {
      this.logger.warn(`Approved corrections unavailable for tenant ${tenantId}; replying without them: ${err instanceof Error ? err.message : 'unknown error'}`);
      return '';
    }
  }
}
