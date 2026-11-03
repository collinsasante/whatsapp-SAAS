import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiLearningCostService } from './learning-cost.service';

export interface LearningSettingsView {
  learningEnabled: boolean;
  learningPaused: boolean;
  approvedGuidanceEnabled: boolean;
  /** True when learning would actually run: opted in and not paused. */
  learningActive: boolean;
  /** Whether this platform currently lets workspaces opt in (set after privacy approval, see optInOpen()). */
  optInAvailable: boolean;
  enabledAt: Date | null;
  /** Micro-USD as decimal strings (BigInt does not serialise to JSON). */
  usage: { workspaceMicros: string; workspaceCapMicros: string };
}

export interface UpdateLearningSettingsInput {
  learningEnabled?: boolean;
  learningPaused?: boolean;
  approvedGuidanceEnabled?: boolean;
  /** Must be true to switch learning ON: the admin has read the disclosure about what is analysed, by whom, and for how long. */
  acknowledgeDisclosure?: boolean;
}

/** Defaults for a workspace that has no settings row: opted OUT, not paused, approved guidance ON. */
export const DEFAULT_LEARNING_SETTINGS = { learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true } as const;

/**
 * Workspace controls for AI Learning. Three independent switches:
 *  - learningEnabled: opt-in. Off for every new workspace. Turning it on needs the disclosure acknowledgement AND the platform opt-in
 *    gate (AI_LEARNING_OPT_IN_OPEN=true), which operators only set after privacy approval. Turning it off is always allowed.
 *  - learningPaused: stops all learning spend and evidence capture without losing the opt-in. Always allowed, either way.
 *  - approvedGuidanceEnabled: only whether already-approved guidance is injected into replies. Independent of the other two.
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
    const previous = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId } });
    const before = { ...DEFAULT_LEARNING_SETTINGS, ...(previous ? this.state(previous) : {}) };

    // Only real booleans are switches; anything else (including null) is ignored here as well as rejected by the DTO.
    const flag = (v: unknown): v is boolean => typeof v === 'boolean';
    if (input.learningEnabled === true && !before.learningEnabled) {
      if (!this.optInOpen()) throw new ForbiddenException('AI learning is not available for workspaces yet.');
      if (input.acknowledgeDisclosure !== true) throw new ConflictException('Switching learning on requires acknowledging the learning disclosure.');
    }

    const changes: Prisma.AiLearningSettingsUpdateInput = {};
    if (flag(input.learningEnabled)) changes.learningEnabled = input.learningEnabled;
    if (flag(input.learningPaused)) changes.learningPaused = input.learningPaused;
    if (flag(input.approvedGuidanceEnabled)) changes.approvedGuidanceEnabled = input.approvedGuidanceEnabled;
    const turningOn = input.learningEnabled === true && !before.learningEnabled;
    if (turningOn) { changes.enabledAt = new Date(); changes.enabledById = actorId; }

    const after = { ...before, ...(flag(input.learningEnabled) && { learningEnabled: input.learningEnabled }), ...(flag(input.learningPaused) && { learningPaused: input.learningPaused }), ...(flag(input.approvedGuidanceEnabled) && { approvedGuidanceEnabled: input.approvedGuidanceEnabled }) };
    const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => after[k] !== before[k]);

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.aiLearningSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...changes } as Prisma.AiLearningSettingsUncheckedCreateInput,
        update: changes,
      });
      if (changed.length > 0) {
        await tx.aiLearningAuditLog.create({
          data: { tenantId, actorId, action: 'learning.settings_updated', targetType: 'learning_settings', targetId: saved.id, previousState: before as Prisma.InputJsonValue, newState: after as Prisma.InputJsonValue },
        });
      }
      return saved;
    });
    return this.view(tenantId, row);
  }

  /** Is AI learning allowed to run for this workspace right now (opted in and not paused)? */
  async isLearningActive(tenantId: string): Promise<boolean> {
    const row = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId }, select: { learningEnabled: true, learningPaused: true } });
    return !!row && row.learningEnabled && !row.learningPaused;
  }

  private state(row: { learningEnabled: boolean; learningPaused: boolean; approvedGuidanceEnabled: boolean }) {
    return { learningEnabled: row.learningEnabled, learningPaused: row.learningPaused, approvedGuidanceEnabled: row.approvedGuidanceEnabled };
  }

  private async view(tenantId: string, row: { learningEnabled: boolean; learningPaused: boolean; approvedGuidanceEnabled: boolean; enabledAt: Date | null } | null): Promise<LearningSettingsView> {
    const s = { ...DEFAULT_LEARNING_SETTINGS, ...(row ? this.state(row) : {}) };
    const usage = await this.cost.summary(tenantId);
    return {
      ...s,
      learningActive: s.learningEnabled && !s.learningPaused,
      optInAvailable: this.optInOpen(),
      enabledAt: row?.enabledAt ?? null,
      usage: { workspaceMicros: usage.workspaceMicros.toString(), workspaceCapMicros: usage.workspaceCapMicros.toString() },
    };
  }
}
