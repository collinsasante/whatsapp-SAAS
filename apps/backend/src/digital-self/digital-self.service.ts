import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DigitalSelf, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OVERRIDE_OPTIONS } from './digital-self.constants';
import { deriveStatus, emptyProfile, parseProfile, summarizeProfile, type ProfileOverrides, type StyleSummary } from './profile.util';
import { CORRECTION_SOURCE, lockDigitalSelf, REPLY_SOURCE, rebuildFromEvents } from './evidence.util';

/** Roles that reply to customers. VIEWER (read-only) and the synthetic Verz AI user are not agents and get no Digital Self. */
export const AGENT_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.AGENT];

/** Anything with the three Prisma delegates we use, so provisioning can run on the client or inside a caller's transaction. */
type DigitalSelfDb = Pick<Prisma.TransactionClient, 'digitalSelf' | 'user'>;

/**
 * Idempotent: creates the user's Digital Self if missing and returns it, or null when the user is not an agent of this tenant.
 * A plain function (not a service method) so user-creation code can call it with its own transaction client without taking on a
 * new dependency; the unique user_id makes a concurrent double call harmless.
 */
export async function provisionDigitalSelf(db: DigitalSelfDb, tenantId: string, userId: string) {
  const user = await db.user.findFirst({ where: { id: userId, tenantId, isAiAgent: false, role: { in: AGENT_ROLES } }, select: { id: true } });
  if (!user) return null;
  await db.digitalSelf.createMany({ data: [{ tenantId, userId, profile: emptyProfile() as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
  return db.digitalSelf.findUnique({ where: { userId } });
}

/** For a user that was JUST created in this transaction: the role is already known, so no read is needed. */
export async function provisionDigitalSelfForNewUser(db: Pick<Prisma.TransactionClient, 'digitalSelf'>, tenantId: string, user: { id: string; role: string }): Promise<void> {
  if (!(AGENT_ROLES as string[]).includes(user.role)) return;
  await db.digitalSelf.createMany({ data: [{ tenantId, userId: user.id, profile: emptyProfile() as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
}

/**
 * Where agent identity lives: a `User` row (tenantId, role, isActive, isAiAgent) plus a `WorkspaceMember` row per workspace
 * (status ACTIVE/SUSPENDED/PENDING). A Digital Self is bound to the User; whether it may be ASSIGNED follows the same
 * lifecycle -- an inactive user, a suspended or pending member, the AI user and a disabled Digital Self are all refused.
 */
@Injectable()
export class DigitalSelfService {
  private readonly logger = new Logger(DigitalSelfService.name);

  constructor(private prisma: PrismaService) {}

  /** Prisma filter for "this user may be represented right now": same tenant, human, active, not suspended or pending. */
  static assignableUserWhere(tenantId: string): Prisma.UserWhereInput {
    return {
      tenantId,
      isActive: true,
      isAiAgent: false,
      role: { in: AGENT_ROLES },
      workspaceMemberships: { none: { workspaceId: tenantId, status: { not: 'ACTIVE' } } },
    };
  }

  /** See provisionDigitalSelf. */
  ensureForUser(tenantId: string, userId: string, db: DigitalSelfDb = this.prisma) {
    return provisionDigitalSelf(db, tenantId, userId);
  }

  /** Creates the missing Digital Selves for every human agent of the tenant (existing agents, or agents created by a path that did not provision). */
  async ensureForTenant(tenantId: string): Promise<number> {
    const missing = await this.prisma.user.findMany({
      where: { tenantId, isAiAgent: false, role: { in: AGENT_ROLES }, digitalSelf: null },
      select: { id: true },
    });
    if (missing.length === 0) return 0;
    const res = await this.prisma.digitalSelf.createMany({
      data: missing.map((u) => ({ tenantId, userId: u.id, profile: emptyProfile() as unknown as Prisma.InputJsonValue })),
      skipDuplicates: true,
    });
    this.logger.log(`Provisioned ${res.count} Digital Self(ves) for tenant ${tenantId}`);
    return res.count;
  }

  /** Every Digital Self of the tenant (provisioning any that are missing), with the agent's name. No raw profile data. */
  async list(tenantId: string): Promise<DigitalSelfView[]> {
    await this.ensureForTenant(tenantId);
    const rows = await this.prisma.digitalSelf.findMany({
      where: { tenantId, user: { isAiAgent: false } },
      include: { user: { select: { name: true, role: true, avatarUrl: true, isActive: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    const assignable = new Set(
      (await this.prisma.user.findMany({ where: { ...DigitalSelfService.assignableUserWhere(tenantId), id: { in: rows.map((r) => r.userId) } }, select: { id: true } })).map((u) => u.id),
    );
    const corrections = await this.prisma.digitalSelfLearningEvent.groupBy({ by: ['digitalSelfId'], where: { tenantId, source: CORRECTION_SOURCE }, _count: { _all: true } });
    const correctionsBy = new Map(corrections.map((c) => [c.digitalSelfId, c._count._all]));
    return rows.map((r) => toView(r, correctionsBy.get(r.id) ?? 0, r.user, assignable.has(r.userId)));
  }

  async get(tenantId: string, id: string): Promise<DigitalSelfView> {
    const row = await this.prisma.digitalSelf.findFirst({
      where: { id, tenantId },
      include: { user: { select: { name: true, role: true, avatarUrl: true, isActive: true } } },
    });
    if (!row) throw new NotFoundException('Digital Self not found');
    const assignable = (await this.prisma.user.count({ where: { ...DigitalSelfService.assignableUserWhere(tenantId), id: row.userId } })) > 0;
    const correctionCount = await this.prisma.digitalSelfLearningEvent.count({ where: { tenantId, digitalSelfId: row.id, source: CORRECTION_SOURCE } });
    return toView(row, correctionCount, row.user, assignable);
  }

  /** Like get(), but a Digital Self that does not exist (deleted since it was assigned) is null. Any other failure still propagates. */
  private async getOrNull(tenantId: string, id: string): Promise<DigitalSelfView | null> {
    try {
      return await this.get(tenantId, id);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  setLearningPaused(tenantId: string, id: string, paused: boolean) {
    return this.mutate(tenantId, id, () => ({ learningPaused: paused }));
  }

  setEnabled(tenantId: string, id: string, enabled: boolean) {
    return this.mutate(tenantId, id, () => ({ enabled }));
  }

  /** Controlled corrections: only the enumerated values, `null` removes an override. Free text is deliberately not accepted, so a profile can never carry instructions. */
  setOverrides(tenantId: string, id: string, patch: { [K in keyof ProfileOverrides]?: ProfileOverrides[K] | null }) {
    return this.mutate(tenantId, id, (row) => {
      const profile = parseProfile(row.profile);
      const overrides: ProfileOverrides = { ...profile.overrides };
      for (const key of Object.keys(OVERRIDE_OPTIONS) as Array<keyof ProfileOverrides>) {
        if (!(key in patch)) continue;
        const value = patch[key];
        if (value === null) delete overrides[key];
        else if (value !== undefined && (OVERRIDE_OPTIONS[key] as readonly string[]).includes(value)) (overrides as Record<string, string>)[key] = value;
      }
      return { profile: { ...profile, overrides } as unknown as Prisma.InputJsonValue };
    });
  }

  /**
   * Forgets what was learned from the agent's own replies (the counters, the evidence count and their dedupe entries). What people
   * decided is kept: business style overrides and approved style corrections, which the profile is rebuilt from.
   */
  async reset(tenantId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockDigitalSelf(tx, id);
      if (!(await tx.digitalSelf.findFirst({ where: { id, tenantId }, select: { id: true } }))) throw new NotFoundException('Digital Self not found');
      await tx.digitalSelfLearningEvent.deleteMany({ where: { digitalSelfId: id, tenantId, source: REPLY_SOURCE } });
      await rebuildFromEvents(tx, tenantId, id);
      await tx.digitalSelf.update({ where: { id }, data: { lastError: null } });
    });
    return this.get(tenantId, id);
  }

  /** The Digital Self a conversation uses, and why: the one assigned explicitly, else its human owner's, else none. */
  async getForConversation(tenantId: string, conversationId: string): Promise<ConversationDigitalSelf> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { digitalSelfId: true, assignedToId: true, digitalSelfLearningExcluded: true, digitalSelfLearningExcludedAt: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    const learning = { excluded: conv.digitalSelfLearningExcluded, excludedAt: conv.digitalSelfLearningExcludedAt };
    const assigned = conv.digitalSelfId ? await this.getOrNull(tenantId, conv.digitalSelfId) : null;
    if (assigned) return { source: 'assigned', digitalSelf: assigned, learning };
    // Default: a conversation a human agent owns is naturally represented by that agent's Digital Self.
    const owner = conv.assignedToId ? await this.prisma.digitalSelf.findFirst({ where: { tenantId, userId: conv.assignedToId }, select: { id: true } }) : null;
    const inherited = owner ? await this.getOrNull(tenantId, owner.id) : null;
    return inherited ? { source: 'owner', digitalSelf: inherited, learning } : { source: null, digitalSelf: null, learning };
  }

  /**
   * Chooses (or, with null, removes) the Digital Self for a conversation. This writes ONLY Conversation.digitalSelfId: it never
   * changes assignedToId (human ownership) and never turns AI replies on -- whether the AI may answer is decided elsewhere,
   * exactly as before. Admins may assign on any conversation; an agent only on one they own.
   */
  async assignToConversation(tenantId: string, conversationId: string, digitalSelfId: string | null, actor: { id: string; role: string }): Promise<ConversationDigitalSelf> {
    await this.assertCanChangeConversation(tenantId, conversationId, actor);

    if (digitalSelfId !== null) {
      const target = await this.prisma.digitalSelf.findFirst({ where: { id: digitalSelfId, tenantId }, select: { id: true, userId: true, enabled: true } });
      if (!target) throw new NotFoundException('Digital Self not found');
      if (!target.enabled) throw new BadRequestException('This Digital Self is deactivated');
      const eligible = await this.prisma.user.count({ where: { ...DigitalSelfService.assignableUserWhere(tenantId), id: target.userId } });
      if (eligible === 0) throw new BadRequestException('This agent is not active in the workspace, so their Digital Self cannot be assigned');
    }

    // tenantId in the filter keeps the write tenant-scoped even though the row was already checked above.
    const res = await this.prisma.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { digitalSelfId } });
    if (res.count === 0) throw new NotFoundException('Conversation not found');
    return this.getForConversation(tenantId, conversationId);
  }

  /** Admins may change any conversation in the workspace; an agent only one they own. Everyone else, and any other tenant's conversation, is refused. */
  private async assertCanChangeConversation(tenantId: string, conversationId: string, actor: { id: string; role: string }): Promise<void> {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { id: true, assignedToId: true } });
    if (!conv) throw new NotFoundException('Conversation not found');
    const isAdmin = actor.role === UserRole.ADMIN || actor.role === 'SUPER_ADMIN';
    if (!isAdmin && !(actor.role === UserRole.AGENT && conv.assignedToId === actor.id)) {
      throw new ForbiddenException('Only an admin, or the agent who owns this conversation, can change this');
    }
  }

  /**
   * Excludes a conversation from Digital Self learning, or lifts the exclusion. Excluding does two things, in this order: it sets the
   * flag (so no learner that starts afterwards can add evidence, and the exclusive row lock makes this wait for learners already
   * running), then it removes everything already learned from that conversation and rebuilds each affected profile from what is
   * left. Lifting the exclusion only allows FUTURE replies to be learned from; removed evidence is not brought back.
   */
  async setConversationLearningExcluded(tenantId: string, conversationId: string, excluded: boolean, actor: { id: string; role: string }): Promise<{ excluded: boolean; excludedAt: Date | null; evidenceRemoved: number; profilesRebuilt: number }> {
    await this.assertCanChangeConversation(tenantId, conversationId, actor);
    const excludedAt = excluded ? new Date() : null;
    const res = await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { digitalSelfLearningExcluded: excluded, digitalSelfLearningExcludedAt: excludedAt, digitalSelfLearningExcludedById: excluded ? actor.id : null },
    });
    if (res.count === 0) throw new NotFoundException('Conversation not found');
    if (!excluded) return { excluded, excludedAt, evidenceRemoved: 0, profilesRebuilt: 0 };

    const affected = await this.prisma.digitalSelfLearningEvent.findMany({ where: { tenantId, conversationId }, distinct: ['digitalSelfId'], select: { digitalSelfId: true } });
    let evidenceRemoved = 0;
    for (const { digitalSelfId } of affected) {
      await this.prisma.$transaction(async (tx) => {
        await lockDigitalSelf(tx, digitalSelfId);
        const deleted = await tx.digitalSelfLearningEvent.deleteMany({ where: { tenantId, digitalSelfId, conversationId } });
        evidenceRemoved += deleted.count;
        if (deleted.count > 0) await rebuildFromEvents(tx, tenantId, digitalSelfId);
      });
    }
    return { excluded, excludedAt, evidenceRemoved, profilesRebuilt: affected.length };
  }

  /** Read-modify-write under the same row lock the learner takes, so an admin edit and a learning job cannot overwrite each other. */
  private async mutate(tenantId: string, id: string, build: (row: DigitalSelf) => Prisma.DigitalSelfUpdateInput): Promise<DigitalSelfView> {
    await this.prisma.$transaction(async (tx) => {
      await lockDigitalSelf(tx, id);
      const row = await tx.digitalSelf.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Digital Self not found');
      const patch = build(row);
      const next = { ...row, ...(patch as Partial<DigitalSelf>) };
      await tx.digitalSelf.update({
        where: { id },
        data: { ...patch, profileVersion: { increment: 1 }, status: deriveStatus({ evidenceCount: next.evidenceCount, enabled: next.enabled, learningPaused: next.learningPaused, lastLearnedAt: next.lastLearnedAt }) },
      });
    });
    return this.get(tenantId, id);
  }
}

export interface ConversationDigitalSelf {
  /** Whether this conversation is excluded from Digital Self learning (a privacy control, separate from which style is used). */
  learning: { excluded: boolean; excludedAt: Date | null };
  /** 'assigned' = chosen for this conversation; 'owner' = inherited from its human owner; null = none (existing AI behaviour). */
  source: 'assigned' | 'owner' | null;
  digitalSelf: DigitalSelfView | null;
}

export interface DigitalSelfView {
  id: string;
  userId: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  /** False when the agent is inactive, suspended, or otherwise cannot be represented right now. */
  assignable: boolean;
  status: string;
  enabled: boolean;
  learningPaused: boolean;
  evidenceCount: number;
  lastLearnedAt: Date | null;
  lastError: string | null;
  profileVersion: number;
  /** Approved style corrections currently applied to this Digital Self. */
  correctionCount: number;
  summary: StyleSummary;
}

function toView(row: DigitalSelf, correctionCount: number, user: { name: string; role: string; avatarUrl: string | null; isActive: boolean }, memberAssignable: boolean): DigitalSelfView {
  return {
    id: row.id,
    userId: row.userId,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    assignable: memberAssignable && user.isActive && row.enabled,
    // Derived now, not read from the column: staleness changes with time, not only with events.
    status: deriveStatus({ evidenceCount: row.evidenceCount, enabled: row.enabled, learningPaused: row.learningPaused, lastLearnedAt: row.lastLearnedAt }),
    enabled: row.enabled,
    learningPaused: row.learningPaused,
    evidenceCount: row.evidenceCount,
    lastLearnedAt: row.lastLearnedAt,
    lastError: row.lastError,
    profileVersion: row.profileVersion,
    correctionCount,
    summary: summarizeProfile(parseProfile(row.profile)),
  };
}
