import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { emptyProfile } from './profile.util';

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
}
