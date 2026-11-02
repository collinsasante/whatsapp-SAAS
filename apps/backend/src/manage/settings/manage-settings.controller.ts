import { Controller, Get, Patch, Post, Body, UseGuards, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UpdateReplyDeadlineDto } from './dto/reply-deadline.dto';
import { UpdateAiSettingsDto, UpdateOffHoursDto, UpdateOptInOutDto, UpdateWelcomeDto, UpdateWidgetDto } from './dto/settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { ManageSettingsService } from './manage-settings.service';
import { ConfigService } from '@nestjs/config';
import { secretsMatch } from '../../common/security/safe-equal.util';

@Controller('manage/settings')
export class ManageSettingsController {
  constructor(
    private service: ManageSettingsService,
    private config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  get(@CurrentUser() u: JwtPayload) { return this.service.get(u.tenantId); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('welcome')
  updateWelcome(@CurrentUser() u: JwtPayload, @Body() body: UpdateWelcomeDto) {
    return this.service.updateWelcome(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('off-hours')
  updateOffHours(@CurrentUser() u: JwtPayload, @Body() body: UpdateOffHoursDto) {
    return this.service.updateOffHours(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('opt-in-out')
  updateOptInOut(@CurrentUser() u: JwtPayload, @Body() body: UpdateOptInOutDto) {
    return this.service.updateOptInOut(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('widget')
  updateWidget(@CurrentUser() u: JwtPayload, @Body() body: UpdateWidgetDto) {
    return this.service.updateWidget(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('ai')
  updateAi(@CurrentUser() u: JwtPayload, @Body() body: UpdateAiSettingsDto) {
    return this.service.updateAi(u.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('reply-deadline')
  updateReplyDeadline(@CurrentUser() u: JwtPayload, @Body() body: UpdateReplyDeadlineDto) {
    return this.service.updateReplyDeadline(u.tenantId, u.sub, body.minutes);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('ai/approve')
  approveAi(@CurrentUser() u: JwtPayload) {
    return this.service.approveAi(u.tenantId);
  }

  /**
   * These routes are reachable from the internet, so the shared secret is the only thing standing between a caller and a notification
   * sent to every admin of any workspace. It FAILS CLOSED: if INTERNAL_SECRET is not configured, every call is refused, never admitted.
   */
  private checkInternalSecret(secret: string | undefined) {
    if (!secretsMatch(secret, this.config.get<string>('INTERNAL_SECRET', ''))) throw new UnauthorizedException();
  }

  /** Checked after the secret, so an unauthenticated caller learns nothing about the expected body. */
  private requireTenantId(body: { tenantId?: unknown } | undefined): string {
    const tenantId = body?.tenantId;
    if (typeof tenantId !== 'string' || !isUUID(tenantId)) throw new BadRequestException('tenantId must be a valid workspace id');
    return tenantId;
  }

  // Called by the worker after the 30-day trial expires
  @Post('ai/trial-expired')
  async trialExpiredInternal(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { tenantId?: unknown },
  ) {
    this.checkInternalSecret(secret);
    await this.service.notifyAiTrialExpired(this.requireTenantId(body));
    return { ok: true };
  }

  // Called by billing cron when subscription is downgraded to free
  @Post('subscription-downgraded')
  async subscriptionDowngradedInternal(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { tenantId?: unknown },
  ) {
    this.checkInternalSecret(secret);
    await this.service.notifySubscriptionDowngraded(this.requireTenantId(body));
    return { ok: true };
  }
}
