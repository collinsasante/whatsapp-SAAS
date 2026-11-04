import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';
import { MessengerHistorySyncService } from './messenger-history-sync.service';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('channels/:channelId/history-sync')
export class MessengerHistorySyncController {
  constructor(private readonly sync: MessengerHistorySyncService) {}

  @Get()
  @ApiOperation({ summary: 'Status of importing a Facebook Page\'s existing conversations' })
  status(@CurrentTenant() tenantId: string, @Param('channelId') channelId: string) {
    return this.sync.getStatus(tenantId, channelId);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Start, resume or retry importing a Facebook Page\'s existing conversations (runs in the background)' })
  start(@CurrentTenant() tenantId: string, @Param('channelId') channelId: string) {
    return this.sync.start(tenantId, channelId);
  }
}
