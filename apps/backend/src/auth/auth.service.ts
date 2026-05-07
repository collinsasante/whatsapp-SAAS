import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokens, JwtPayload } from '@whatsapp-platform/shared-types';
import { generateSlug } from '@whatsapp-platform/shared-utils';

@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens & { user: object; tenant: object }> {
    const slug = generateSlug(dto.workspaceName);
    const uniqueSlug = `${slug}-${uuidv4().split('-')[0]}`;

    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug: uniqueSlug } });
    if (existingTenant) throw new ConflictException('Workspace with this name already exists');

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.workspaceName,
          slug: uniqueSlug,
          webhookVerifyToken: uuidv4(),
          settings: {
            create: {
              businessName: dto.workspaceName,
              businessEmail: dto.email,
            },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: 'ADMIN',
        },
        select: { id: true, email: true, name: true, role: true, tenantId: true },
      });

      return { tenant, user };
    });

    const tokens = await this.generateTokens(result.user.id, result.user.email, result.tenant.id, result.user.role);

    await this.updateRefreshToken(result.user.id, tokens.refreshToken);
    await this.auditService.log({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'LOGIN',
      resource: 'auth',
    });

    return { ...tokens, user: result.user, tenant: result.tenant };
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthTokens & { user: object; tenant: object }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug, isActive: true },
    });

    if (!tenant) throw new NotFoundException('Workspace not found');

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
    });

    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    await this.auditService.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress,
    });

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: tenant.id, name: tenant.name, slug: tenant.slug };

    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async refreshTokens(userId: string, refreshToken: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.refreshToken) throw new UnauthorizedException('Access denied');

    const isValid = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!isValid) throw new UnauthorizedException('Access denied');

    const tokens = await this.generateTokens(user.id, user.email, user.tenantId, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  private async generateTokens(userId: string, email: string, tenantId: string, role: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email, tenantId, role: role as JwtPayload['role'] };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('app.jwtSecret'),
        expiresIn: this.configService.get<string>('app.jwtExpiresIn', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('app.jwtRefreshSecret'),
        expiresIn: this.configService.get<string>('app.jwtRefreshExpiresIn', '7d'),
      }),
    ]);

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashed = await bcrypt.hash(refreshToken, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });
  }
}
