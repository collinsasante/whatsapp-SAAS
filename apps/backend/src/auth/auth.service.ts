import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
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
    // Auto-generate workspace name from user's name
    const workspaceName = `${dto.name.split(' ')[0]}'s Workspace`;
    const slug = generateSlug(workspaceName);
    const uniqueSlug = `${slug}-${uuidv4().split('-')[0]}`;

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: workspaceName,
          slug: uniqueSlug,
          webhookVerifyToken: uuidv4(),
          settings: {
            create: {
              businessName: workspaceName,
              businessEmail: dto.email,
              businessPhone: dto.phoneNumber ?? null,
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
    await this.auditService.log({ tenantId: result.tenant.id, userId: result.user.id, action: 'LOGIN', resource: 'auth' });

    return { ...tokens, user: result.user, tenant: result.tenant };
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthTokens & { user: object; tenant: object }> {
    let user: Awaited<ReturnType<typeof this.prisma.user.findFirst>>;
    let tenant: Awaited<ReturnType<typeof this.prisma.tenant.findUnique>> | null = null;

    if (dto.tenantSlug) {
      tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug, isActive: true } });
      if (!tenant) throw new NotFoundException('Workspace not found');
      user = await this.prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      });
    } else {
      // Find user by email across all active tenants
      user = await this.prisma.user.findFirst({
        where: { email: dto.email, isActive: true },
      });
      if (user) {
        tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId, isActive: true } });
      }
    }

    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    if (!tenant) throw new UnauthorizedException('Workspace not found');
    if (!user.passwordHash) throw new UnauthorizedException('Please sign in with Google');

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    await this.auditService.log({ tenantId: tenant.id, userId: user.id, action: 'LOGIN', resource: 'auth', ipAddress });

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: tenant.id, name: tenant.name, slug: tenant.slug };

    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async loginWithGoogle(code: string): Promise<AuthTokens & { user: object; tenant: object }> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');

    if (!clientId || !clientSecret) throw new BadRequestException('Google OAuth is not configured');

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${apiUrl}/auth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed');
    const tokenData = await tokenRes.json() as { access_token: string };

    // Get user info from Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new UnauthorizedException('Failed to get Google user info');
    const googleUser = await userRes.json() as { email: string; name: string; id: string };

    // Find or create user
    let user = await this.prisma.user.findFirst({ where: { email: googleUser.email, isActive: true } });
    let tenant = user ? await this.prisma.tenant.findUnique({ where: { id: user.tenantId } }) : null;

    if (!user || !tenant) {
      // Create new workspace + admin user
      const workspaceName = `${googleUser.name.split(' ')[0]}'s Workspace`;
      const slug = `${generateSlug(workspaceName)}-${uuidv4().split('-')[0]}`;

      const result = await this.prisma.$transaction(async (tx) => {
        const newTenant = await tx.tenant.create({
          data: {
            name: workspaceName,
            slug,
            webhookVerifyToken: uuidv4(),
            settings: { create: { businessName: workspaceName, businessEmail: googleUser.email } },
          },
        });
        const newUser = await tx.user.create({
          data: { tenantId: newTenant.id, email: googleUser.email, name: googleUser.name, role: 'ADMIN', passwordHash: '' },
          select: { id: true, email: true, name: true, role: true, tenantId: true },
        });
        return { tenant: newTenant, user: newUser };
      });
      user = result.user as unknown as typeof user;
      tenant = result.tenant;
    }

    const tokens = await this.generateTokens(user!.id, user!.email, tenant!.id, user!.role);
    await this.updateRefreshToken(user!.id, tokens.refreshToken);

    const safeUser = { id: user!.id, email: user!.email, name: user!.name, role: user!.role, tenantId: user!.tenantId };
    const safeTenant = { id: tenant!.id, name: tenant!.name, slug: tenant!.slug };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    // Decode the refresh token to get userId — does not require valid access token
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('app.jwtRefreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Access denied');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.refreshToken) throw new UnauthorizedException('Access denied');

    const isValid = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!isValid) throw new UnauthorizedException('Access denied');

    const tokens = await this.generateTokens(user.id, user.email, user.tenantId, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    // Always return success to prevent email enumeration
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const resetToken = this.jwtService.sign(
      { sub: user.id, type: 'reset' },
      { secret: this.configService.get<string>('app.jwtSecret'), expiresIn: '1h' },
    );

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // TODO: Send email via mail service. For now, log to console.
    console.log(`[Password Reset] Link for ${email}: ${resetLink}`);

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(token, { secret: this.configService.get<string>('app.jwtSecret') });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (payload.type !== 'reset') throw new BadRequestException('Invalid token type');

    const passwordHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: payload.sub }, data: { passwordHash, refreshToken: null } });

    return { message: 'Password reset successfully' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, tenantId: true, avatarUrl: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw new UnauthorizedException('Tenant not found');
    return { user, tenant };
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshToken: null } });
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
    await this.prisma.user.update({ where: { id: userId }, data: { refreshToken: hashed } });
  }
}
