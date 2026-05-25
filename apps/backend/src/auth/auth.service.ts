import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../common/email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokens, JwtPayload } from '@whatsapp-platform/shared-types';
import { UpdateProfileDto, ChangePasswordDto } from './dto/update-profile.dto';
import { workspaceRoleToUserRole } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly OTP_ROUNDS = 10;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ requiresEmailVerification: boolean; email: string }> {
    const workspaceName = `${dto.name.split(' ')[0]}'s Workspace`;
    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);
    const verifyToken = uuidv4();
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: workspaceName,
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
          emailVerified: process.env['SKIP_EMAIL_VERIFICATION'] === 'true',
          emailVerifyToken: verifyToken,
          emailVerifyExpiry: verifyExpiry,
        },
        select: { id: true, email: true, name: true, role: true, tenantId: true },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: tenant.id,
          userId: user.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      return { tenant, user };
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verifyLink = `${frontendUrl}/verify-email?token=${verifyToken}`;

    void this.emailService.sendEmailVerification({
      to: dto.email,
      name: dto.name,
      verifyLink,
    }).catch((err) => this.logger.error('Failed to send verification email', err));

    return {
      requiresEmailVerification: process.env['SKIP_EMAIL_VERIFICATION'] !== 'true',
      email: dto.email,
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });

    if (!user) throw new BadRequestException('Invalid or expired verification link');
    if (user.emailVerifyExpiry && user.emailVerifyExpiry < new Date()) {
      throw new BadRequestException('Verification link has expired. Please request a new one.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null },
    });

    return { message: 'Email verified successfully. You can now sign in.' };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    // Always return success to prevent enumeration
    if (!user || user.emailVerified) return { message: 'If that email exists and is unverified, a new link has been sent.' };

    const verifyToken = uuidv4();
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken: verifyToken, emailVerifyExpiry: verifyExpiry },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verifyLink = `${frontendUrl}/verify-email?token=${verifyToken}`;

    void this.emailService.sendEmailVerification({ to: user.email, name: user.name, verifyLink })
      .catch((err) => this.logger.error('Failed to resend verification email', err));

    return { message: 'If that email exists and is unverified, a new link has been sent.' };
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<
    | { requiresPin: true; tempToken: string }
    | { requiresPinSetup: true; tempToken: string }
    | { requiresWorkspaceSelection: true; workspaces: { id: string; name: string; logoUrl: string | null }[]; tempToken: string }
    | (AuthTokens & { user: object; tenant: object })
  > {
    // Find ALL active users with this email across all workspaces
    const allUsers = await this.prisma.user.findMany({
      where: { email: dto.email, isActive: true },
    });

    if (!allUsers.length) throw new UnauthorizedException('Invalid credentials');

    // Validate password against the first user that has a hash
    const authenticatedUser = allUsers.find((u) => u.passwordHash);
    if (!authenticatedUser) throw new UnauthorizedException('Please sign in with Google');

    const isPasswordValid = await bcrypt.compare(dto.password, authenticatedUser.passwordHash);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    // If multiple workspaces share this email, let the user pick before issuing a JWT
    if (allUsers.length > 1) {
      const workspaceIds = allUsers.map((u) => u.tenantId);
      const workspaces = await this.prisma.tenant.findMany({
        where: { id: { in: workspaceIds }, isActive: true },
        select: { id: true, name: true, logoUrl: true },
      });

      if (!authenticatedUser.emailVerified && process.env['SKIP_EMAIL_VERIFICATION'] !== 'true') {
        throw new ForbiddenException({
          message: 'Please verify your email before signing in.',
          code: 'email_not_verified',
          email: authenticatedUser.email,
        });
      }

      // Temp token proves password was verified; workspace selection completes the login
      const tempToken = this.jwtService.sign(
        { sub: authenticatedUser.id, email: dto.email, type: 'workspace-select' },
        { secret: this.configService.get<string>('app.jwtSecret'), expiresIn: '15m' },
      );
      return { requiresWorkspaceSelection: true, workspaces, tempToken };
    }

    const user = allUsers[0];
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId, isActive: true } });

    if (!user.isActive) throw new UnauthorizedException('Invalid credentials');
    if (!tenant) throw new UnauthorizedException('Workspace not found');
    if (!user.passwordHash) throw new UnauthorizedException('Please sign in with Google');

    if (!user.emailVerified && process.env['SKIP_EMAIL_VERIFICATION'] !== 'true') {
      throw new ForbiddenException({
        message: 'Please verify your email before signing in.',
        code: 'email_not_verified',
        email: user.email,
      });
    }

    // Skip 2FA in local development
    if (process.env['SKIP_2FA'] === 'true') {
      await this.auditService.log({ tenantId: tenant.id, userId: user.id, action: 'LOGIN', resource: 'auth', ipAddress });
      const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
      await this.updateRefreshToken(user.id, tokens.refreshToken);
      const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
      const safeTenant = { id: tenant.id, name: tenant.name, onboardingCompleted: tenant.onboardingCompleted };
      return { ...tokens, user: safeUser, tenant: safeTenant };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    // Temp token proves password was verified; expires in 15 min
    const tempToken = this.jwtService.sign(
      { sub: user.id, type: '2fa-pending' },
      { secret: this.configService.get<string>('app.jwtSecret'), expiresIn: '15m' },
    );

    // First login ever — user must set their PIN
    if (!user.loginPin) {
      return { requiresPinSetup: true, tempToken };
    }

    return { requiresPin: true, tempToken };
  }

  async selectWorkspace(
    tempToken: string,
    tenantId: string,
    ipAddress?: string,
  ): Promise<AuthTokens & { user: object; tenant: object }> {
    let payload: { sub: string; email: string; type: string };
    try {
      payload = this.jwtService.verify(tempToken, { secret: this.configService.get<string>('app.jwtSecret') });
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (payload.type !== 'workspace-select') throw new UnauthorizedException('Invalid token');

    // Find the user record that belongs to the chosen workspace
    const user = await this.prisma.user.findFirst({
      where: { email: payload.email, tenantId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('No access to that workspace');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId, isActive: true } });
    if (!tenant) throw new UnauthorizedException('Workspace not found');

    await this.auditService.log({ tenantId, userId: user.id, action: 'LOGIN', resource: 'auth', ipAddress });
    const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: tenant.id, name: tenant.name, onboardingCompleted: tenant.onboardingCompleted };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async verify2FA(tempToken: string, pin: string, ipAddress?: string): Promise<AuthTokens & { user: object; tenant: object }> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(tempToken, { secret: this.configService.get<string>('app.jwtSecret') });
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    if (payload.type !== '2fa-pending') throw new UnauthorizedException('Invalid token');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.loginPin) {
      throw new UnauthorizedException('No PIN set. Please sign in again.');
    }

    const isValid = await bcrypt.compare(pin, user.loginPin);
    if (!isValid) throw new UnauthorizedException('Incorrect PIN. Please try again.');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId, isActive: true } });
    if (!tenant) throw new UnauthorizedException('Workspace not found');

    await this.auditService.log({ tenantId: tenant.id, userId: user.id, action: 'LOGIN', resource: 'auth', ipAddress });

    const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: tenant.id, name: tenant.name, onboardingCompleted: tenant.onboardingCompleted };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async setupPin(tempToken: string, pin: string, ipAddress?: string): Promise<AuthTokens & { user: object; tenant: object }> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(tempToken, { secret: this.configService.get<string>('app.jwtSecret') });
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    if (payload.type !== '2fa-pending') throw new UnauthorizedException('Invalid token');
    if (!/^\d{6}$/.test(pin)) throw new BadRequestException('PIN must be exactly 6 digits');

    const pinHash = await bcrypt.hash(pin, this.BCRYPT_ROUNDS);

    const user = await this.prisma.user.update({
      where: { id: payload.sub },
      data: { loginPin: pinHash },
    });

    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId, isActive: true } });
    if (!tenant) throw new UnauthorizedException('Workspace not found');

    await this.auditService.log({ tenantId: tenant.id, userId: user.id, action: 'LOGIN', resource: 'auth', ipAddress });

    const tokens = await this.generateTokens(user.id, user.email, tenant.id, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: tenant.id, name: tenant.name, onboardingCompleted: tenant.onboardingCompleted };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async loginWithGoogle(code: string): Promise<AuthTokens & { user: object; tenant: object }> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');

    if (!clientId || !clientSecret) throw new BadRequestException('Google OAuth is not configured');

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

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new UnauthorizedException('Failed to get Google user info');
    const googleUser = await userRes.json() as { email: string; name: string; id: string };

    let user = await this.prisma.user.findFirst({ where: { email: googleUser.email, isActive: true } });
    let tenant = user ? await this.prisma.tenant.findUnique({ where: { id: user.tenantId } }) : null;

    if (!user || !tenant) {
      const workspaceName = `${googleUser.name.split(' ')[0]}'s Workspace`;
      const result = await this.prisma.$transaction(async (tx) => {
        const newTenant = await tx.tenant.create({
          data: {
            name: workspaceName,
            webhookVerifyToken: uuidv4(),
            settings: { create: { businessName: workspaceName, businessEmail: googleUser.email } },
          },
        });
        const newUser = await tx.user.create({
          data: {
            tenantId: newTenant.id,
            email: googleUser.email,
            name: googleUser.name,
            role: 'ADMIN',
            passwordHash: '',
            emailVerified: true, // Google already verified the email
          },
          select: { id: true, email: true, name: true, role: true, tenantId: true },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: newTenant.id, userId: newUser.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
        });
        return { tenant: newTenant, user: newUser };
      });
      user = result.user as unknown as typeof user;
      tenant = result.tenant;
    }

    const tokens = await this.generateTokens(user!.id, user!.email, tenant!.id, user!.role);
    await this.updateRefreshToken(user!.id, tokens.refreshToken);

    const safeUser = { id: user!.id, email: user!.email, name: user!.name, role: user!.role, tenantId: user!.tenantId };
    const safeTenant = { id: tenant!.id, name: tenant!.name, onboardingCompleted: tenant!.onboardingCompleted };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
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
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const resetToken = this.jwtService.sign(
      { sub: user.id, type: 'reset' },
      { secret: this.configService.get<string>('app.jwtSecret'), expiresIn: '1h' },
    );

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    void this.emailService.sendPasswordReset({ to: user.email, name: user.name, resetLink })
      .catch((err) => this.logger.error('Failed to send password reset email', err));

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
    // Also clear loginPin so the user sets a new one on next login
    await this.prisma.user.update({ where: { id: payload.sub }, data: { passwordHash, refreshToken: null, loginPin: null } });

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
      select: { id: true, name: true, onboardingCompleted: true, plan: true, logoUrl: true },
    });
    if (!tenant) throw new UnauthorizedException('Tenant not found');
    return { user, tenant };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, tenantId: true, avatarUrl: true },
    });
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) throw new BadRequestException('Password not set for this account');
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');
    const hashed = await bcrypt.hash(dto.newPassword, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hashed } });
  }

  async changePin(userId: string, dto: { currentPin?: string; newPin: string }) {
    if (!/^\d{4,6}$/.test(dto.newPin)) throw new BadRequestException('PIN must be 4–6 digits');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { loginPin: true } });
    if (!user) throw new UnauthorizedException('User not found');

    if (user.loginPin) {
      if (!dto.currentPin) throw new BadRequestException('Current PIN required');
      const valid = await bcrypt.compare(dto.currentPin, user.loginPin);
      if (!valid) throw new BadRequestException('Current PIN is incorrect');
    }

    const pinHash = await bcrypt.hash(dto.newPin, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { loginPin: pinHash } });
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshToken: null } });
  }

  async getWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const workspaces = workspaceIds.length
      ? await this.prisma.tenant.findMany({
          where: { id: { in: workspaceIds }, isActive: true },
          select: { id: true, name: true },
        })
      : [];
    return workspaces.map((ws) => {
      const m = memberships.find((mem) => mem.workspaceId === ws.id)!;
      return { ...ws, role: m.role };
    });
  }

  async switchWorkspace(userId: string, workspaceId: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspaceId, status: 'ACTIVE' },
    });
    const isTenantOwner = user.tenantId === workspaceId;
    if (!membership && !isTenantOwner) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    const workspace = await this.prisma.tenant.findUnique({ where: { id: workspaceId, isActive: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const effectiveRole = membership ? workspaceRoleToUserRole(membership.role) : user.role;
    const tokens = await this.generateTokens(user.id, user.email, workspaceId, effectiveRole);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async verifyInvite(token: string) {
    const inv = await this.prisma.workspaceInvitation.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invitation not found or already used');
    if (inv.acceptedAt) throw new BadRequestException('Invitation already accepted');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    const workspace = await this.prisma.tenant.findUnique({
      where: { id: inv.workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) throw new NotFoundException('Workspace no longer exists');

    const inviter = await this.prisma.user.findUnique({
      where: { id: inv.invitedById },
      select: { name: true },
    });

    return {
      email: inv.email,
      name: inv.name,
      role: inv.role,
      expiresAt: inv.expiresAt,
      workspace,
      inviterName: inviter?.name ?? 'Someone',
    };
  }

  async acceptInvite(
    token: string,
    data: { name?: string; password?: string },
  ): Promise<AuthTokens & { user: object; tenant: object }> {
    const inv = await this.prisma.workspaceInvitation.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.acceptedAt) throw new BadRequestException('Invitation already accepted');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation has expired');

    const workspace = await this.prisma.tenant.findUnique({ where: { id: inv.workspaceId, isActive: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    let user = await this.prisma.user.findFirst({ where: { email: inv.email } });

    if (!user) {
      if (!data.name || !data.password) {
        throw new BadRequestException('Name and password are required for new accounts');
      }
      const passwordHash = await bcrypt.hash(data.password, this.BCRYPT_ROUNDS);
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            tenantId: inv.workspaceId,
            email: inv.email,
            name: data.name!,
            passwordHash,
            role: 'AGENT',
            emailVerified: true, // invited via email — already verified
          },
        });
        await tx.workspaceMember.create({
          data: {
            workspaceId: inv.workspaceId,
            userId: newUser.id,
            role: inv.role,
            status: 'ACTIVE',
            invitedById: inv.invitedById,
            joinedAt: new Date(),
          },
        });
        await tx.workspaceInvitation.update({
          where: { id: inv.id },
          data: { acceptedAt: new Date() },
        });
        return newUser;
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user!.id } },
          create: {
            workspaceId: inv.workspaceId,
            userId: user!.id,
            role: inv.role,
            status: 'ACTIVE',
            invitedById: inv.invitedById,
            joinedAt: new Date(),
          },
          update: { role: inv.role, status: 'ACTIVE', joinedAt: new Date() },
        });
        await tx.workspaceInvitation.update({
          where: { id: inv.id },
          data: { acceptedAt: new Date() },
        });
      });
    }

    const effectiveRole = workspaceRoleToUserRole(inv.role);
    const tokens = await this.generateTokens(user.id, user.email, inv.workspaceId, effectiveRole);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    const safeTenant = { id: workspace.id, name: workspace.name };
    return { ...tokens, user: safeUser, tenant: safeTenant };
  }

  private async generateTokens(userId: string, email: string, tenantId: string, role: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email, tenantId, role: role as JwtPayload['role'] };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('app.jwtSecret'),
        expiresIn: this.configService.get<string>('app.jwtExpiresIn', '30d'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('app.jwtRefreshSecret'),
        expiresIn: this.configService.get<string>('app.jwtRefreshExpiresIn', '90d'),
      }),
    ]);

    return { accessToken, refreshToken, expiresIn: 30 * 24 * 60 * 60 };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashed = await bcrypt.hash(refreshToken, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { refreshToken: hashed } });
  }
}
