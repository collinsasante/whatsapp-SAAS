import { Controller, Post, Get, Body, UseGuards, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { PlatformAdminAuthService } from '../services/platform-admin-auth.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminSetupDto } from '../dto/admin-setup.dto';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';

@Controller('platform-admin/auth')
export class PlatformAdminAuthController {
  constructor(private authService: PlatformAdminAuthService) {}

  /** One-time setup: creates the first platform admin. Requires PLATFORM_ADMIN_SETUP_SECRET. */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(@Body() dto: AdminSetupDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    return this.authService.setup(dto, ip);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    const ua = req.headers['user-agent'];
    return this.authService.login(dto, ip, ua);
  }

  @Get('me')
  @UseGuards(PlatformAdminGuard)
  getMe(@CurrentAdmin() admin: PlatformAdminPayload) {
    return this.authService.getMe(admin.sub);
  }

  @Post('logout')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentAdmin() admin: PlatformAdminPayload, @Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] ?? '';
    await this.authService.logout(admin.sub, token);
    return { success: true };
  }

  @Get('sessions')
  @UseGuards(PlatformAdminGuard)
  getSessions(@CurrentAdmin() admin: PlatformAdminPayload) {
    return this.authService.getSessions(admin.sub);
  }
}
