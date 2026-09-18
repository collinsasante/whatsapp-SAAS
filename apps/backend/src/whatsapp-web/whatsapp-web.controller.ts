import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WhatsAppWebService } from './whatsapp-web.service';
import { StartWhatsAppWebSessionDto } from './dto/whatsapp-web.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

// Unofficial WhatsApp Web (QR/linked-device) pairing flow. Mounted under
// channels/ so it sits alongside the official channel-connect endpoints for
// the frontend, but lives in its own module/service -- a structurally
// different connection mechanism (a live socket + session state, not an
// OAuth token exchange), matching how Facebook Messenger's own webhook/
// service logic lives in its own dedicated module rather than being folded
// into ChannelsService.
@ApiTags('WhatsApp Web (unofficial)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('channels/whatsapp-web')
export class WhatsAppWebController {
  constructor(private readonly whatsAppWebService: WhatsAppWebService) {}

  @Post('sessions')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Start a new WhatsApp Web pairing session (returns a QR code via realtime)' })
  startPairing(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartWhatsAppWebSessionDto,
  ) {
    return this.whatsAppWebService.startPairing(tenantId, user.sub, dto.name);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get the current status of a WhatsApp Web pairing/connection session' })
  getSessionStatus(@CurrentTenant() tenantId: string, @Param('sessionId') sessionId: string) {
    return this.whatsAppWebService.getSessionStatus(tenantId, sessionId);
  }

  @Post('sessions/:sessionId/disconnect')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Disconnect a WhatsApp Web session (can be reconnected without re-scanning, if the linked device stays valid)' })
  disconnect(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string) {
    return this.whatsAppWebService.disconnectSession(tenantId, sessionId, user.sub);
  }

  @Post('sessions/:sessionId/logout')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Fully log out a WhatsApp Web session (unlinks the device -- reconnecting needs a fresh QR scan)' })
  logout(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string) {
    return this.whatsAppWebService.logoutSession(tenantId, sessionId, user.sub);
  }
}
