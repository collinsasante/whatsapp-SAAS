import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminSetupDto } from '../dto/admin-setup.dto';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';

@Injectable()
export class PlatformAdminAuthService {
  private readonly BCRYPT_ROUNDS = 12;
  private readonly TOKEN_EXPIRY = '8h';

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: PlatformAuditService,
  ) {}

  private getAdminSecret(): string {
    const jwtSecret = this.configService.get<string>('app.jwtSecret', 'changeme');
    return (
      this.configService.get<string>('PLATFORM_ADMIN_JWT_SECRET') || `${jwtSecret}_padmin`
    );
  }

  private signToken(admin: { id: string; email: string; name: string; role: string }): string {
    const payload: PlatformAdminPayload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      type: 'platform_admin',
    };
    return this.jwtService.sign(payload, {
      secret: this.getAdminSecret(),
      expiresIn: this.TOKEN_EXPIRY,
    });
  }

  async setup(dto: AdminSetupDto, ipAddress?: string): Promise<{ accessToken: string; admin: object }> {
    const setupSecret = this.configService.get<string>('PLATFORM_ADMIN_SETUP_SECRET');
    if (!setupSecret || dto.setupSecret !== setupSecret) {
      throw new ForbiddenException('Invalid setup secret');
    }

    const count = await this.prisma.platformAdmin.count();
    if (count > 0) {
      throw new ConflictException('Platform admin already exists. Use login instead.');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);
    const admin = await this.prisma.platformAdmin.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: 'SUPER_ADMIN',
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress ?? null,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    const accessToken = this.signToken(admin);
    await this.createSession(admin.id, accessToken, ipAddress);
    await this.auditService.log({ adminId: admin.id, action: 'ADMIN_SETUP', metadata: { email: admin.email }, ipAddress });

    return { accessToken, admin };
  }

  async login(dto: AdminLoginDto, ipAddress?: string, userAgent?: string): Promise<{ accessToken: string; admin: object }> {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) {
      await this.auditService.log({
        adminId: admin.id,
        action: 'ADMIN_LOGIN_FAILED',
        metadata: { email: dto.email },
        ipAddress,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ipAddress ?? null },
    });

    const accessToken = this.signToken(admin);
    await this.createSession(admin.id, accessToken, ipAddress, userAgent);
    await this.auditService.log({
      adminId: admin.id,
      action: 'ADMIN_LOGIN',
      metadata: { email: admin.email },
      ipAddress,
      userAgent,
    });

    return {
      accessToken,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    };
  }

  async getMe(adminId: string) {
    return this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true, lastLoginIp: true, createdAt: true },
    });
  }

  async logout(adminId: string, token: string) {
    const hash = this.hashToken(token);
    await this.prisma.adminSession.updateMany({
      where: { adminId, tokenHash: hash },
      data: { isRevoked: true },
    });
    await this.auditService.log({ adminId, action: 'ADMIN_LOGOUT' });
  }

  async getSessions(adminId: string) {
    return this.prisma.adminSession.findMany({
      where: { adminId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastActiveAt: true },
    });
  }

  async revokeSession(adminId: string, sessionId: string) {
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, adminId },
      data: { isRevoked: true },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async createSession(adminId: string, token: string, ipAddress?: string, userAgent?: string) {
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8h
    await this.prisma.adminSession.create({
      data: {
        adminId,
        tokenHash: this.hashToken(token),
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        expiresAt,
      },
    });
  }
}
