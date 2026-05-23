import { Controller, Get, Patch, Post, Body, UseGuards, Headers, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { ManageSettingsService } from './manage-settings.service';
import { ConfigService } from '@nestjs/config';

@Controller('manage/settings')
export class ManageSettingsController {
  constructor(
    private service: ManageSettingsService,
    private config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  get(@CurrentUser() u: JwtPayload) { return this.service.get(u.tenantId); }

  @UseGuards(JwtAuthGuard)
  @Patch('welcome')
  updateWelcome(@CurrentUser() u: JwtPayload, @Body() body: { welcomeEnabled?: boolean; welcomeMessage?: string }) {
    return this.service.updateWelcome(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('off-hours')
  updateOffHours(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateOffHours(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('opt-in-out')
  updateOptInOut(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateOptInOut(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('widget')
  updateWidget(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateWidget(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('ai')
  updateAi(@CurrentUser() u: JwtPayload, @Body() body: { aiEnabled?: boolean; aiAlwaysOn?: boolean; aiPersonality?: string }) {
    return this.service.updateAi(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('ai/approve')
  approveAi(@CurrentUser() u: JwtPayload) {
    return this.service.approveAi(u.tenantId);
  }

  private checkInternalSecret(secret: string) {
    const expected = this.config.get<string>('INTERNAL_SECRET', '');
    if (expected && secret !== expected) throw new UnauthorizedException();
  }

  // Called by the worker after the 30-day trial expires
  @Post('ai/trial-expired')
  async trialExpiredInternal(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { tenantId: string },
  ) {
    this.checkInternalSecret(secret);
    await this.service.notifyAiTrialExpired(body.tenantId);
    return { ok: true };
  }

  // Called by billing cron when subscription is downgraded to free
  @Post('subscription-downgraded')
  async subscriptionDowngradedInternal(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { tenantId: string },
  ) {
    this.checkInternalSecret(secret);
    await this.service.notifySubscriptionDowngraded(body.tenantId);
    return { ok: true };
  }
}
