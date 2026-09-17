import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto, SelectFacebookPagesDto } from './dto/channel.dto';
import { signOAuthState, verifyOAuthState } from './oauth-state.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly configService: ConfigService,
  ) {}

  // Falls back to JWT_SECRET if OAUTH_STATE_SECRET isn't set -- not a hard
  // deploy blocker (JWT_SECRET is always configured), but a dedicated
  // secret should be set for this in real environments.
  private get oauthStateSecret(): string {
    return this.configService.get<string>('OAUTH_STATE_SECRET') ?? this.configService.get<string>('JWT_SECRET', 'insecure-dev-fallback');
  }

  @Get()
  @ApiOperation({ summary: 'List all channels' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.channelsService.findAll(tenantId);
  }

  @Get('oauth/:provider')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.FOUND)
  @ApiOperation({ summary: 'Initiate OAuth for a social channel' })
  oauthRedirect(
    @Param('provider') provider: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');

    if (!['facebook', 'instagram', 'tiktok'].includes(provider)) {
      return res.redirect(`${frontendUrl}/channels?error=unsupported_provider`);
    }

    const credKey = provider === 'tiktok' ? 'TIKTOK_CLIENT_ID' : 'FACEBOOK_APP_ID';
    const appId = this.configService.get<string>(credKey);
    if (!appId) {
      return res.redirect(`${frontendUrl}/channels?error=not_configured&provider=${provider}`);
    }

    // Signed, expiring, server-derived state -- tenantId/userId come from the
    // authenticated request, never a client-suppliable query param, so the
    // callback can trust them without a separate lookup. This route used to
    // be @Public() with tenantId read straight off the query string, which
    // let anyone attach their own Page/account to an arbitrary tenant.
    const state = signOAuthState({ tenantId, provider, userId: user.sub }, this.oauthStateSecret);
    const callbackUri = `${apiUrl}/channels/oauth/${provider}/callback`;

    if (provider === 'tiktok') {
      const params = new URLSearchParams({
        client_key: appId,
        response_type: 'code',
        scope: 'user.info.basic',
        redirect_uri: callbackUri,
        state,
      });
      return res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
    }

    // pages_messaging is required for the Messenger Send API and webhook
    // subscription (added alongside the Facebook Messenger channel work --
    // the pre-existing pages_show_list/pages_read_engagement scopes only
    // ever supported listing Pages, never messaging through them).
    const scope = provider === 'instagram'
      ? 'instagram_basic,pages_show_list,pages_read_engagement'
      : 'pages_show_list,pages_read_engagement,pages_messaging';

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: callbackUri,
      scope,
      response_type: 'code',
      state,
    });

    return res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
  }

  @Get('oauth/:provider/callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  @ApiOperation({ summary: 'OAuth callback handler' })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') stateToken: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');

    if (oauthError || !code || !stateToken) {
      return res.redirect(`${frontendUrl}/channels?error=auth_cancelled&provider=${provider}`);
    }

    const verified = verifyOAuthState(stateToken, this.oauthStateSecret);
    if (!verified || verified.provider !== provider) {
      return res.redirect(`${frontendUrl}/channels?error=invalid_state&provider=${provider}`);
    }
    const { tenantId, userId } = verified;

    try {
      if (provider === 'facebook') {
        // Real Page-selection flow: fetch candidate Pages, stash them in a
        // short-lived session, let the user choose -- never auto-connect.
        const { sessionId } = await this.channelsService.startFacebookPageSelection(
          tenantId, userId, code, `${apiUrl}/channels/oauth/${provider}/callback`,
        );
        return res.redirect(`${frontendUrl}/channels?picker=facebook&session=${sessionId}`);
      }

      await this.channelsService.connectOAuth(
        provider,
        tenantId,
        code,
        `${apiUrl}/channels/oauth/${provider}/callback`,
      );
      return res.redirect(`${frontendUrl}/channels?success=${provider}`);
    } catch (e) {
      const msg = e instanceof Error ? encodeURIComponent(e.message) : 'auth_failed';
      return res.redirect(`${frontendUrl}/channels?error=${msg}&provider=${provider}`);
    }
  }

  @Get('oauth/sessions/:sessionId')
  @ApiOperation({ summary: 'Candidate Facebook Pages for a pending connection session' })
  getOAuthSession(@CurrentTenant() tenantId: string, @Param('sessionId') sessionId: string) {
    return this.channelsService.getFacebookConnectSession(tenantId, sessionId);
  }

  @Post('oauth/sessions/:sessionId/select')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Connect the selected Facebook Page(s) from a pending session' })
  selectFacebookPages(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
    @Body() dto: SelectFacebookPagesDto,
  ) {
    return this.channelsService.selectFacebookPages(tenantId, user.sub, sessionId, dto.pageIds);
  }

  @Post('telegram/connect')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Connect a Telegram bot via token' })
  async connectTelegram(
    @CurrentTenant() tenantId: string,
    @Body() body: { botToken: string },
  ) {
    return this.channelsService.connectTelegramBot(tenantId, body.botToken);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.channelsService.findOne(tenantId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new channel' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(tenantId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a channel' })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(tenantId, id, dto, user.sub);
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Toggle channel active status' })
  toggle(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.channelsService.toggle(tenantId, id, user.sub);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a channel' })
  remove(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.channelsService.remove(tenantId, id, user.sub);
  }
}
