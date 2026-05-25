import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AdminLoginDto, AdminSetupDto } from './dto/platform-admin.dto';

@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async setup(dto: AdminSetupDto) {
    const setupSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    if (!setupSecret || dto.setupSecret !== setupSecret) {
      throw new UnauthorizedException('Invalid setup secret');
    }

    const existing = await this.prisma.platformAdmin.findFirst();
    if (existing) throw new ConflictException('Platform admin already configured');

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

  async me(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true, lastLoginIp: true },
    });
    if (!admin) throw new UnauthorizedException();
    return admin;
  }
}
