import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';

const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'] as const;
type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const INVITE_TTL_HOURS = 72;

const MEMBER_SELECT = {
  id: true, workspaceId: true, userId: true,
  role: true, status: true, department: true,
  invitedById: true, joinedAt: true, createdAt: true, updatedAt: true,
};

@Injectable()
export class WorkspaceService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditService: AuditService,
    private realtimeService: RealtimeService,
  ) {}

  // ─── Member listing ──────────────────────────────────────────────────────────

  async listMembers(tenantId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: tenantId },
      select: MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    const userIds = members.map((m) => m.userId);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true, email: true, name: true, avatarUrl: true,
            phone: true, isActive: true, lastSeenAt: true, lastLoginAt: true,
          },
        })
      : [];

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    return members.map((m) => ({ ...m, user: userMap[m.userId] ?? null }));
  }

  // ─── Edit member profile ─────────────────────────────────────────────────────

  async editMember(
    tenantId: string,
    memberId: string,
    actorId: string,
    dto: {
      name?: string; email?: string; phone?: string; avatarUrl?: string;
      role?: string; department?: string; status?: string;
    },
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');

    const isSelf = member.userId === actorId;

    // Only admins/owners can change role or status of others
    if (!isSelf && (dto.role || dto.status)) {
      if (dto.role && !WORKSPACE_ROLES.includes(dto.role as WorkspaceRole)) {
        throw new BadRequestException('Invalid role');
      }
    }

    // Build user update
    const userPatch: Record<string, unknown> = {};
    if (dto.name !== undefined) userPatch.name = dto.name;
    if (dto.email !== undefined) userPatch.email = dto.email;
    if (dto.phone !== undefined) userPatch.phone = dto.phone;
    if (dto.avatarUrl !== undefined) userPatch.avatarUrl = dto.avatarUrl;

    // Build member update
    const memberPatch: Record<string, unknown> = {};
    if (dto.role !== undefined) memberPatch.role = dto.role;
    if (dto.department !== undefined) memberPatch.department = dto.department;
    if (dto.status !== undefined && ['ACTIVE', 'SUSPENDED'].includes(dto.status)) {
      memberPatch.status = dto.status;
    }

    const [updatedMember] = await this.prisma.$transaction([
      ...(Object.keys(userPatch).length
        ? [this.prisma.user.update({ where: { id: member.userId }, data: userPatch })]
        : []),
      ...(Object.keys(memberPatch).length
        ? [this.prisma.workspaceMember.update({ where: { id: memberId }, data: memberPatch })]
        : []),
    ]);

    // If role changed, notify the user to refresh their token
    if (dto.role && dto.role !== member.role) {
      this.realtimeService.emitRoleChanged(member.userId, dto.role, tenantId);
    }

    void this.auditService.log({
      tenantId, userId: actorId, action: 'UPDATE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: { action: 'EDIT_MEMBER', changes: { ...userPatch, ...memberPatch } },
    });

    this.realtimeService.emitMemberUpdated(tenantId, member.userId, { ...userPatch, ...memberPatch });

    return updatedMember ?? { memberId, updated: true };
  }

  // ─── Suspend member ──────────────────────────────────────────────────────────

  async suspendMember(tenantId: string, memberId: string, actorId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.userId === actorId) throw new ForbiddenException('Cannot suspend yourself');
    if (member.status === 'SUSPENDED') throw new ConflictException('Member is already suspended');
    if (member.role === 'OWNER') throw new ForbiddenException('Cannot suspend the workspace owner');

    await this.prisma.$transaction([
      this.prisma.workspaceMember.update({
        where: { id: memberId },
        data: { status: 'SUSPENDED' },
      }),
      // Clear refresh token to immediately invalidate all sessions
      this.prisma.user.update({
        where: { id: member.userId },
        data: { refreshToken: null },
      }),
    ]);

    // Force-disconnect the user's socket connection
    this.realtimeService.emitForceLogout(member.userId, 'suspended');
    this.realtimeService.emitMemberUpdated(tenantId, member.userId, { status: 'SUSPENDED' });

    void this.auditService.log({
      tenantId, userId: actorId, action: 'UPDATE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: { action: 'SUSPEND_MEMBER', targetUserId: member.userId },
    });

    return { success: true };
  }

  // ─── Reactivate member ───────────────────────────────────────────────────────

  async reactivateMember(tenantId: string, memberId: string, actorId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.status !== 'SUSPENDED') throw new ConflictException('Member is not suspended');

    await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { status: 'ACTIVE' },
    });

    this.realtimeService.emitMemberUpdated(tenantId, member.userId, { status: 'ACTIVE' });

    void this.auditService.log({
      tenantId, userId: actorId, action: 'UPDATE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: { action: 'REACTIVATE_MEMBER', targetUserId: member.userId },
    });

    return { success: true };
  }

  // ─── Force logout ────────────────────────────────────────────────────────────

  async forceLogout(tenantId: string, memberId: string, actorId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.userId === actorId) throw new ForbiddenException('Use the normal logout for your own session');

    // Clear refresh token so existing sessions cannot be refreshed
    await this.prisma.user.update({
      where: { id: member.userId },
      data: { refreshToken: null },
    });

    this.realtimeService.emitForceLogout(member.userId, 'forced');

    void this.auditService.log({
      tenantId, userId: actorId, action: 'UPDATE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: { action: 'FORCE_LOGOUT', targetUserId: member.userId },
    });

    return { success: true };
  }

  // ─── Remove member ───────────────────────────────────────────────────────────

  async removeMember(
    tenantId: string,
    memberId: string,
    actorId: string,
    reassignToId?: string,
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.userId === actorId) throw new ForbiddenException('Cannot remove yourself from the workspace');

    const ownerCount = await this.prisma.workspaceMember.count({
      where: { workspaceId: tenantId, role: 'OWNER', status: 'ACTIVE' },
    });
    if (member.role === 'OWNER' && ownerCount <= 1) {
      throw new ForbiddenException('Cannot remove the last workspace owner');
    }

    let reassignedCount = 0;

    if (reassignToId) {
      // Verify the target agent is a member of this workspace
      const targetMember = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: tenantId, userId: reassignToId, status: 'ACTIVE' },
      });
      if (!targetMember) throw new BadRequestException('Reassignment target is not an active workspace member');

      const result = await this.prisma.conversation.updateMany({
        where: { tenantId, assignedToId: member.userId, status: { notIn: ['RESOLVED'] } },
        data: { assignedToId: reassignToId },
      });
      reassignedCount = result.count;

      // Emit realtime updates for each reassigned conversation
      if (reassignedCount > 0) {
        this.realtimeService.emitConversationsReassigned(tenantId, member.userId, reassignToId, reassignedCount);
      }
    } else {
      // Leave unassigned
      await this.prisma.conversation.updateMany({
        where: { tenantId, assignedToId: member.userId, status: { notIn: ['RESOLVED'] } },
        data: { assignedToId: null },
      });
    }

    // Remove membership and invalidate sessions
    await this.prisma.$transaction([
      this.prisma.workspaceMember.delete({ where: { id: memberId } }),
      this.prisma.user.update({ where: { id: member.userId }, data: { refreshToken: null } }),
    ]);

    this.realtimeService.emitForceLogout(member.userId, 'removed');
    this.realtimeService.emitMemberUpdated(tenantId, member.userId, { action: 'removed' });

    void this.auditService.log({
      tenantId, userId: actorId, action: 'DELETE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: {
        action: 'REMOVE_MEMBER', targetUserId: member.userId,
        reassignedCount, reassignedToId: reassignToId ?? null,
      },
    });

    return { success: true, reassignedCount };
  }

  // ─── Reset password (admin-initiated) ────────────────────────────────────────

  async resetMemberPassword(
    tenantId: string,
    memberId: string,
    actorId: string,
    newPassword: string,
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.userId === actorId) throw new ForbiddenException('Use the profile settings to change your own password');

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: member.userId },
      data: { passwordHash, refreshToken: null },
    });

    this.realtimeService.emitForceLogout(member.userId, 'password_reset');

    void this.auditService.log({
      tenantId, userId: actorId, action: 'UPDATE',
      resource: 'workspace_member', resourceId: member.userId,
      metadata: { action: 'RESET_PASSWORD', targetUserId: member.userId },
    });

    return { success: true };
  }

  // ─── Member activity stats ───────────────────────────────────────────────────

  async getMemberActivity(tenantId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
      select: { ...MEMBER_SELECT, user: { select: { id: true, name: true, email: true, avatarUrl: true, lastSeenAt: true, lastLoginAt: true } } },
    });
    if (!member) throw new NotFoundException('Member not found');

    const userId = member.userId;

    const [
      assignedConvCount,
      resolvedConvCount,
      sentMessageCount,
      noteCount,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId, assignedToId: userId } }),
      this.prisma.conversation.count({ where: { tenantId, assignedToId: userId, status: 'RESOLVED' } }),
      this.prisma.message.count({ where: { tenantId, senderId: userId } }),
      this.prisma.conversationNote.count({ where: { authorId: userId } }),
    ]);

    return {
      member,
      stats: {
        assignedConversations: assignedConvCount,
        resolvedConversations: resolvedConvCount,
        sentMessages: sentMessageCount,
        notesAdded: noteCount,
      },
    };
  }

  // ─── Invitations ─────────────────────────────────────────────────────────────

  async createInvitation(
    tenantId: string,
    invitedById: string,
    email: string,
    role: string,
    name?: string,
  ): Promise<{ token: string; link: string; expiresAt: Date }> {
    if (!WORKSPACE_ROLES.includes(role as WorkspaceRole)) {
      throw new BadRequestException(`Invalid role. Must be one of: ${WORKSPACE_ROLES.join(', ')}`);
    }

    const existingUser = await this.prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      const existingMember = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: tenantId, userId: existingUser.id, status: 'ACTIVE' },
      });
      if (existingMember) throw new ConflictException('This user is already a member of this workspace');
    }

    await this.prisma.workspaceInvitation.deleteMany({
      where: { workspaceId: tenantId, email, acceptedAt: null },
    });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    await this.prisma.workspaceInvitation.create({
      data: { workspaceId: tenantId, email, name: name ?? null, role, token, invitedById, expiresAt },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const link = `${frontendUrl}/join/${token}`;

    void this.auditService.log({
      tenantId, userId: invitedById, action: 'CREATE',
      resource: 'workspace_invitation',
      metadata: { email, role },
    });

    return { token, link, expiresAt };
  }

  async listInvitations(tenantId: string) {
    return this.prisma.workspaceInvitation.findMany({
      where: { workspaceId: tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelInvitation(tenantId: string, invitationId: string) {
    const inv = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId: tenantId },
    });
    if (!inv) throw new NotFoundException('Invitation not found');
    await this.prisma.workspaceInvitation.delete({ where: { id: invitationId } });
  }

  // ─── Conversation count for a member ────────────────────────────────────────

  async getMemberConversations(tenantId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: tenantId },
    });
    if (!member) throw new NotFoundException('Member not found');

    const [open, resolved, total] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId, assignedToId: member.userId, status: 'OPEN' } }),
      this.prisma.conversation.count({ where: { tenantId, assignedToId: member.userId, status: 'RESOLVED' } }),
      this.prisma.conversation.count({ where: { tenantId, assignedToId: member.userId } }),
    ]);

    return { open, resolved, total };
  }
}
