import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all channels' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.channelsService.findAll(tenantId);
  }

  @Get('oauth/:provider')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  @ApiOperation({ summary: 'Initiate OAuth for a social channel' })
  oauthRedirect(
    @Param('provider') provider: string,
    @Query('tenantId') tenantId: string,
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

    const state = Buffer.from(JSON.stringify({ tenantId, provider })).toString('base64');
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

    const scope = provider === 'instagram'
      ? 'instagram_basic,pages_show_list,pages_read_engagement'
      : 'pages_show_list,pages_read_engagement';

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
    @Query('state') stateB64: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');

    if (oauthError || !code || !stateB64) {
      return res.redirect(`${frontendUrl}/channels?error=auth_cancelled&provider=${provider}`);
    }

    try {
      const { tenantId } = JSON.parse(Buffer.from(stateB64, 'base64').toString()) as { tenantId: string };
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
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a channel' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(tenantId, id, dto);
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Toggle channel active status' })
  toggle(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.channelsService.toggle(tenantId, id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a channel' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.channelsService.remove(tenantId, id);
  }
}
