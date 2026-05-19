import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';

@Injectable()
export class ImpersonationService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: PlatformAuditService,
  ) {}

  async impersonate(workspaceId: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.tenant.findUnique({
      where: { id: workspaceId },
      include: {
        workspaceMembers: {
          where: { role: 'OWNER' },
          take: 1,
          include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } } },
        },
        settings: { select: { businessName: true } },
      },
    });

    if (!workspace) throw new NotFoundException(`Workspace ${workspaceId} not found`);
    if (!workspace.isActive) throw new NotFoundException('Workspace is suspended');

    // Find owner, fallback to first active admin user
    const ownerUser = workspace.workspaceMembers[0]?.user ?? null;
    const fallbackUser = !ownerUser
      ? await this.prisma.user.findFirst({
          where: { tenantId: workspaceId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, email: true, name: true, role: true, isActive: true },
        })
      : null;
    const targetUser = ownerUser ?? fallbackUser;

    if (!targetUser) throw new NotFoundException('No active user found in workspace');

    // Generate impersonation token using the regular JWT secret (accepted by workspace JWT strategy)
    const jwtSecret = this.configService.get<string>('app.jwtSecret', 'changeme');
    const token = this.jwtService.sign(
      {
        sub: targetUser.id,
        email: targetUser.email,
        tenantId: workspaceId,
        role: 'SUPER_ADMIN', // full access during impersonation
        isImpersonation: true,
        impersonatedBy: adminId,
        impersonatorEmail: adminEmail,
      },
      { secret: jwtSecret, expiresIn: '2h' },
    );

    await this.auditService.log({
      adminId,
      action: 'IMPERSONATION_STARTED',
      resourceType: 'WORKSPACE',
      resourceId: workspaceId,
      metadata: {
        workspaceName: workspace.name,
        targetUserId: targetUser.id,
        targetUserEmail: targetUser.email,
        adminEmail,
      },
    });

    return {
      accessToken: token,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
      },
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: 'SUPER_ADMIN',
        tenantId: workspaceId,
      },
    };
  }
}
