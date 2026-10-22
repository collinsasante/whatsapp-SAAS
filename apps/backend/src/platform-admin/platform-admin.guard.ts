import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_ROLES_KEY, PlatformAdminRole } from './decorators/require-platform-role.decorator';

const KNOWN_ADMIN_ROLES: readonly PlatformAdminRole[] = ['SUPER_ADMIN', 'SUPPORT', 'VIEWER'];

export interface PlatformAdminJwtPayload {
  sub: string;
  role: string;
  adminRole?: PlatformAdminRole;
  email?: string;
}

export type AdminRequest = Request & { adminId: string; adminRole: PlatformAdminRole };

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing admin token');

    const token = authHeader.slice(7);
    let payload: PlatformAdminJwtPayload;
    try {
      payload = this.jwtService.verify<PlatformAdminJwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }

    // Authenticated (valid JWT) but not a platform-admin token at all -- e.g. a tenant
    // user's own valid JWT. This is a 403 (authenticated, wrong audience), not a 401.
    if (payload.role !== 'platform_admin') {
      throw new ForbiddenException('Not a platform admin');
    }

    const requiredRoles = this.reflector.getAllAndOverride<PlatformAdminRole[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // The token only proves who signed in. Whether that admin may still act, and as which role, is decided from the
    // database on every request, so a switched-off or demoted admin loses access immediately instead of when the
    // token expires, and a token minted anywhere else (for example by another environment sharing a secret) is useless
    // unless this database has that admin.
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, role: true },
    });
    if (!admin?.isActive) throw new UnauthorizedException('This admin account is not active');
    const adminRole: PlatformAdminRole = KNOWN_ADMIN_ROLES.includes(admin.role as PlatformAdminRole)
      ? (admin.role as PlatformAdminRole)
      : 'VIEWER';

    if (requiredRoles?.length && !requiredRoles.includes(adminRole)) {
      throw new ForbiddenException(`This action requires one of: ${requiredRoles.join(', ')}`);
    }

    request.adminId = payload.sub;
    request.adminRole = adminRole;
    return true;
  }
}
