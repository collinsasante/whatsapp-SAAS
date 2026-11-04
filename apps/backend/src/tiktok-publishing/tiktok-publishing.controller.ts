import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { TikTokPublishingService } from './tiktok-publishing.service';
import { TIKTOK_MAX_CAPTION, TIKTOK_PRIVACY_LEVELS } from './tiktok-publish.util';

import { StrictBoolean } from '../common/validation/strict-boolean.decorator';
export class CreateTikTokPublicationDto {
  @IsUUID() channelId!: string;
  @IsString() @MinLength(3) @MaxLength(300) mediaKey!: string;
  @IsString() @MaxLength(TIKTOK_MAX_CAPTION * 2) caption!: string;
  @IsOptional() @IsIn([...TIKTOK_PRIVACY_LEVELS]) privacyLevel?: string;
  @IsOptional() @IsString() @MaxLength(100) idempotencyKey?: string;
}

export class RetryTikTokPublicationDto {
  @IsOptional() @StrictBoolean() confirmNotPosted?: boolean;
}

@ApiTags('TikTok publishing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tiktok/publications')
export class TikTokPublishingController {
  constructor(private readonly service: TikTokPublishingService) {}

  @Get('config')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Whether TikTok publishing is on for this workspace, and which visibilities are allowed' })
  config(@CurrentTenant() tenantId: string) { return this.service.status(tenantId); }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT)
  list(@CurrentTenant() tenantId: string, @Query('channelId') channelId?: string) { return this.service.list(tenantId, channelId); }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT)
  get(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(tenantId, id); }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Queue a video to be posted to a connected TikTok account' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateTikTokPublicationDto) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  retry(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryTikTokPublicationDto) {
    return this.service.retry(tenantId, user.sub, id, dto?.confirmNotPosted === true);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(tenantId, user.sub, id);
  }
}
