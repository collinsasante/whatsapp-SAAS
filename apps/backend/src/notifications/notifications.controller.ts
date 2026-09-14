import { Body, Controller, Delete, Get, Patch, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { NotificationsService } from './notifications.service';
import { PushTokenService } from './push-token.service';
import { RegisterPushTokenDto, UnregisterPushTokenDto } from './dto/push-token.dto';

@ApiTags('Notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly svc: NotificationsService,
    private readonly pushTokens: PushTokenService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.svc.findAll(user.sub, user.tenantId, limit ? Number(limit) : 30);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.svc.getUnreadCount(user.sub, user.tenantId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.markRead(id, user.sub);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.svc.markAllRead(user.sub, user.tenantId);
  }

  @Post('push-token')
  @ApiOperation({ summary: 'Register (or re-register) this device for push notifications' })
  registerPushToken(@CurrentUser() user: JwtPayload, @Body() dto: RegisterPushTokenDto) {
    return this.pushTokens.register(user.sub, user.tenantId, dto.token, dto.platform);
  }

  @Delete('push-token')
  @ApiOperation({ summary: 'Unregister a device push token (e.g. on logout)' })
  unregisterPushToken(@Body() dto: UnregisterPushTokenDto) {
    return this.pushTokens.unregister(dto.token);
  }
}
