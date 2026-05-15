import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

export function workspaceRoleToUserRole(role: string): UserRole {
  const map: Record<string, UserRole> = {
    OWNER:   UserRole.SUPER_ADMIN,
    ADMIN:   UserRole.ADMIN,
    MANAGER: UserRole.ADMIN,
    AGENT:   UserRole.AGENT,
    ANALYST: UserRole.VIEWER,
    VIEWER:  UserRole.VIEWER,
  };
  return map[role] ?? UserRole.AGENT;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('app.jwtSecret', 'changeme'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User not found or inactive');

    // Check explicit workspace membership (covers invited/switched users)
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id, workspaceId: payload.tenantId },
    });

    if (membership?.status === 'SUSPENDED') {
      throw new UnauthorizedException('Your access to this workspace has been suspended');
    }

    if (!membership && user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Access to this workspace denied');
    }

    const effectiveRole = membership
      ? workspaceRoleToUserRole(membership.role)
      : (user.role as UserRole);

    return {
      sub:      user.id,
      email:    user.email,
      tenantId: payload.tenantId,
      role:     effectiveRole,
    };
  }
}
