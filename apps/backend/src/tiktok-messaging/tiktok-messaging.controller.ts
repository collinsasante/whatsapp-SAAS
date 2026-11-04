import { Controller, ForbiddenException, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { verifyOAuthState } from '../channels/oauth-state.util';
import { TikTokMessagingService } from './tiktok-messaging.service';

/** TikTok's event delivery. Public by necessity; trusted only through the signature over the raw body. */
@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhook/tiktok-messaging')
export class TikTokMessagingWebhookController {
  constructor(private readonly service: TikTokMessagingService) {}

  @Post()
  @Public()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    // A processing failure surfaces as 500 so TikTok redelivers; messages are de-duplicated by TikTok's message id.
    const r = await this.service.handleWebhook(req.rawBody, req.headers['tiktok-signature'] as string | undefined);
    return { ok: true, status: r.status };
  }
}

@ApiTags('TikTok messaging')
@Controller('tiktok/messaging')
export class TikTokMessagingController {
  private readonly logger = new Logger(TikTokMessagingController.name);
  constructor(private readonly service: TikTokMessagingService, private readonly config: ConfigService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Whether TikTok messaging can be used, what is still missing, and the connected accounts' })
  status(@CurrentTenant() tenantId: string) { return this.service.status(tenantId); }

  @Get('authorize-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async authorizeUrl(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const unmet = await this.service.unmet(tenantId);
    if (unmet.length > 0) throw new ForbiddenException(`TikTok messaging is not enabled. ${unmet[0]}`);
    return { redirectUrl: this.service.authorizeUrl(tenantId, user.sub) };
  }

  @Get('callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  async callback(@Query('auth_code') authCode: string | undefined, @Query('code') code: string | undefined, @Query('state') state: string, @Res() res: Response) {
    const frontend = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const secret = this.config.get<string>('OAUTH_STATE_SECRET') ?? this.config.get<string>('JWT_SECRET', 'insecure-dev-fallback');
    const verified = verifyOAuthState(state, secret);
    const given = authCode ?? code;
    if (!verified || verified.provider !== 'tiktok-messaging' || !given) return res.redirect(`${frontend}/channels?error=auth_cancelled&provider=tiktok-messaging`);
    try {
      await this.service.completeAuthorization(verified.tenantId, verified.userId, given);
      return res.redirect(`${frontend}/channels?success=tiktok-messaging`);
    } catch (e) {
      this.logger.warn(`TikTok messaging callback failed: ${e instanceof Error ? e.name : 'error'}`);
      return res.redirect(`${frontend}/channels?error=${encodeURIComponent(e instanceof Error ? e.message : 'auth_failed')}&provider=tiktok-messaging`);
    }
  }

  @Post('channels/:id/import-history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  importHistory(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.importHistory(tenantId, user.sub, id);
  }

  @Post('webhook/register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Platform operators: point TikTok DIRECT_MESSAGE events at this server (app-level, once)' })
  registerWebhook() { return this.service.registerWebhook(); }
}
