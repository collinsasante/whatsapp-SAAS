import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@ApiTags('Activity Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get tenant-wide activity log' })
  getAll(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.activityLogService.getForTenant(tenantId, limit ? parseInt(limit, 10) : 50);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get activity log for a conversation' })
  getForConversation(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.activityLogService.getForConversation(tenantId, conversationId);
  }
}
