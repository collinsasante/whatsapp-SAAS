import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiLearningCostService } from './learning-cost.service';
import { LearningDisclosure, buildLearningDisclosure } from './learning-disclosure';
import { learningBlockReason } from './learning-eligibility';

export interface LearningSettingsView {
  learningEnabled: boolean;
  learningPaused: boolean;
  approvedGuidanceEnabled: boolean;
  /** True only when learning would actually run: opted in, not paused, and the CURRENT disclosure acknowledged. */
  learningActive: boolean;
  /** Why it is not active (null when it is). 'disclosure_outdated' means the notice changed and must be acknowledged again. */
  blockedReason: 'not_enabled' | 'disclosure_outdated' | 'paused' | null;
  /** Whether this platform currently lets workspaces opt in (set after privacy approval, see optInOpen()). */
  optInAvailable: boolean;
  enabledAt: Date | null;
  /** The notice an administrator must acknowledge, with the version that acknowledgement is recorded against. */
  disclosure: LearningDisclosure;
  acknowledgement: {
    version: string | null;
    at: Date | null;
    byId: string | null;
    /** The recorded acknowledgement is of the current version. */
    current: boolean;
    /** Learning is switched on but cannot run until the current notice is acknowledged. */
    needsAcknowledgement: boolean;
  };
  /** Micro-USD as decimal strings (BigInt does not serialise to JSON). */
  usage: { workspaceMicros: string; workspaceCapMicros: string };
}

export interface UpdateLearningSettingsInput {
  learningEnabled?: boolean;
  learningPaused?: boolean;
  approvedGuidanceEnabled?: boolean;
  /**
   * The version of the notice the administrator has read, copied from the settings view they were shown. Needed to switch learning ON,
   * and to resume after the notice changed. A version that is not the current one is refused, so a stale page cannot record agreement
   * to wording that is no longer in force.
   */
  acknowledgedDisclosureVersion?: string;
}

/** Defaults for a workspace that has no settings row: opted OUT, not paused, approved guidance ON. */
export const DEFAULT_LEARNING_SETTINGS = { learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true } as const;

type SettingsRow = {
  learningEnabled: boolean; learningPaused: boolean; approvedGuidanceEnabled: boolean; enabledAt: Date | null;
  disclosureVersion: string | null; disclosureAcknowledgedAt: Date | null; disclosureAcknowledgedById: string | null;
};

/**
 * Workspace controls for AI Learning. Three independent switches plus a versioned acknowledgement:
 *  - learningEnabled: opt-in. Off for every new workspace. Turning it on needs the current notice acknowledged AND the platform opt-in
 *    gate (AI_LEARNING_OPT_IN_OPEN=true), which operators only set after privacy approval. Turning it off is always allowed.
 *  - learningPaused: stops all learning spend and evidence capture without losing the opt-in. Always allowed, either way.
 *  - approvedGuidanceEnabled: only whether already-approved guidance is injected into replies. Independent of the other two.
 *  - acknowledgement: who agreed to which version, and when. If the notice changes, learning stops until the current one is acknowledged.
 * Money limits (the monthly budget override) are deliberately NOT settable here: a workspace must not raise its own platform-funded cap.
 */
@Injectable()
export class AiLearningSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cost: AiLearningCostService,
  ) {}

  /** Privacy approval gate: learning cannot be switched on by any workspace until an operator opens it. */
  optInOpen(): boolean {
    return process.env['AI_LEARNING_OPT_IN_OPEN'] === 'true';
  }

  async get(tenantId: string): Promise<LearningSettingsView> {
    const row = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId } });
    return this.view(tenantId, row);
  }

  async update(tenantId: string, actorId: string, input: UpdateLearningSettingsInput): Promise<LearningSettingsView> {
    const disclosure = buildLearningDisclosure();
    const previous = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId } });
    const before = this.state(previous);

    // Only real booleans are switches; anything else (including null) is ignored here as well as rejected by the DTO.
    const flag = (v: unknown): v is boolean => typeof v === 'boolean';
    const acknowledged = typeof input.acknowledgedDisclosureVersion === 'string' ? input.acknowledgedDisclosureVersion : undefined;
    if (acknowledged !== undefined && acknowledged !== disclosure.version) {
      throw new ConflictException({ code: 'DISCLOSURE_OUTDATED', message: 'The learning notice has changed. Reload and read the current notice before acknowledging it.', currentVersion: disclosure.version });
    }
    const turningOn = input.learningEnabled === true && !before.learningEnabled;
    if (turningOn) {
      if (!this.optInOpen()) throw new ForbiddenException('AI learning is not available for workspaces yet.');
      if (acknowledged === undefined) throw new ConflictException({ code: 'DISCLOSURE_ACKNOWLEDGEMENT_REQUIRED', message: 'Switching learning on requires acknowledging the current learning notice.', currentVersion: disclosure.version });
    }

    const changes: Prisma.AiLearningSettingsUpdateInput = {};
    if (flag(input.learningEnabled)) changes.learningEnabled = input.learningEnabled;
    if (flag(input.learningPaused)) changes.learningPaused = input.learningPaused;
    if (flag(input.approvedGuidanceEnabled)) changes.approvedGuidanceEnabled = input.approvedGuidanceEnabled;
    if (turningOn) { changes.enabledAt = new Date(); changes.enabledById = actorId; }
    const recordsAcknowledgement = acknowledged !== undefined && previous?.disclosureVersion !== acknowledged;
    if (recordsAcknowledgement) {
      changes.disclosureVersion = acknowledged;
      changes.disclosureAcknowledgedAt = new Date();
      changes.disclosureAcknowledgedById = actorId;
    }

    const after = {
      ...before,
      ...(flag(input.learningEnabled) && { learningEnabled: input.learningEnabled }),
      ...(flag(input.learningPaused) && { learningPaused: input.learningPaused }),
      ...(flag(input.approvedGuidanceEnabled) && { approvedGuidanceEnabled: input.approvedGuidanceEnabled }),
      ...(recordsAcknowledgement && { disclosureVersion: acknowledged }),
    };
    const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => after[k] !== before[k]);

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.aiLearningSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...changes } as Prisma.AiLearningSettingsUncheckedCreateInput,
        update: changes,
      });
      if (changed.length > 0) {
        // Flags and the disclosure VERSION only: never conversation content, never the notice text itself.
        await tx.aiLearningAuditLog.create({
          data: { tenantId, actorId, action: 'learning.settings_updated', targetType: 'learning_settings', targetId: saved.id, previousState: before as Prisma.InputJsonValue, newState: after as Prisma.InputJsonValue },
        });
      }
      return saved;
    });
    return this.view(tenantId, row);
  }

  /** Is AI learning allowed to run for this workspace right now? (opted in, not paused, current notice acknowledged) */
  async isLearningActive(tenantId: string): Promise<boolean> {
    const row = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId }, select: { learningEnabled: true, learningPaused: true, disclosureVersion: true } });
    return learningBlockReason(row) === null;
  }

  private state(row: Pick<SettingsRow, 'learningEnabled' | 'learningPaused' | 'approvedGuidanceEnabled' | 'disclosureVersion'> | null) {
    return {
      learningEnabled: row?.learningEnabled ?? DEFAULT_LEARNING_SETTINGS.learningEnabled,
      learningPaused: row?.learningPaused ?? DEFAULT_LEARNING_SETTINGS.learningPaused,
      approvedGuidanceEnabled: row?.approvedGuidanceEnabled ?? DEFAULT_LEARNING_SETTINGS.approvedGuidanceEnabled,
      disclosureVersion: row?.disclosureVersion ?? null,
    };
  }

  private async view(tenantId: string, row: SettingsRow | null): Promise<LearningSettingsView> {
    const s = this.state(row);
    const disclosure = buildLearningDisclosure();
    const blockedReason = learningBlockReason({ learningEnabled: s.learningEnabled, learningPaused: s.learningPaused, disclosureVersion: s.disclosureVersion }, disclosure.version);
    const current = s.disclosureVersion === disclosure.version;
    const usage = await this.cost.summary(tenantId);
    return {
      learningEnabled: s.learningEnabled,
      learningPaused: s.learningPaused,
      approvedGuidanceEnabled: s.approvedGuidanceEnabled,
      learningActive: blockedReason === null,
      blockedReason,
      optInAvailable: this.optInOpen(),
      enabledAt: row?.enabledAt ?? null,
      disclosure,
      acknowledgement: {
        version: s.disclosureVersion,
        at: row?.disclosureAcknowledgedAt ?? null,
        byId: row?.disclosureAcknowledgedById ?? null,
        current,
        needsAcknowledgement: s.learningEnabled && !current,
      },
      usage: { workspaceMicros: usage.workspaceMicros.toString(), workspaceCapMicros: usage.workspaceCapMicros.toString() },
    };
  }
}
