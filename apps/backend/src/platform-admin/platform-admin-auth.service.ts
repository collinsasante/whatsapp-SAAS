import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { AdminLoginDto, AdminSetupDto } from './dto/platform-admin.dto';

@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private emailService: EmailService,
  ) {}

  async setup(dto: AdminSetupDto) {
    const setupSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    if (!setupSecret || dto.setupSecret !== setupSecret) {
      throw new UnauthorizedException('Invalid setup secret');
    }

    const existing = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Admin with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const admin = await this.prisma.platformAdmin.create({
      data: { email: dto.email, name: dto.name, passwordHash, role: 'SUPER_ADMIN' },
      select: { id: true, email: true, name: true, role: true },
    });

    return { message: 'Admin account created', admin };
  }

  async login(dto: AdminLoginDto, ip?: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email } });
    if (!admin?.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    const token = this.jwtService.sign(
      { sub: admin.id, role: 'platform_admin', email: admin.email },
      { secret: this.config.get<string>('JWT_SECRET'), expiresIn: '12h' },
    );

    return { token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } };
  }

  async requestPasswordReset(email: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin) return; // Silent — don't reveal if email exists

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await (this.prisma.platformAdmin as any).update({
      where: { id: admin.id },
      data: { resetToken: token, resetTokenExpiresAt: expiresAt },
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://verzchat.com');
    const resetUrl = `${frontendUrl}/platform-admin/reset-password?token=${token}`;

    await this.emailService.sendRaw({
      to: email,
      subject: 'Platform Admin — Password Reset',
      html: `
        <p>Hi ${admin.name},</p>
        <p>Click the link below to reset your Platform Admin password. The link expires in 1 hour.</p>
        <p><a href="${resetUrl}" style="color:#0d9488;font-weight:600">Reset Password</a></p>
        <p>If you didn't request this, ignore this email.</p>
      `,
    });
  }

  async resetPassword(token: string, newPassword: string) {
    const admin = await (this.prisma.platformAdmin as any).findFirst({
      where: { resetToken: token, resetTokenExpiresAt: { gt: new Date() } },
    });
    if (!admin) throw new BadRequestException('Invalid or expired reset link');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await (this.prisma.platformAdmin as any).update({
      where: { id: admin.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    return { message: 'Password updated successfully' };
  }

  async me(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true, lastLoginIp: true },
    });
    if (!admin) throw new UnauthorizedException();
    return admin;
  }
}
