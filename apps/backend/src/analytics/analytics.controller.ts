import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { UserRole, JwtPayload } from '@whatsapp-platform/shared-types';
import { DateRangeQueryDto, ConversationsQueryDto } from './dto/analytics.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Overview summary cards -- admins see tenant-wide + revenue, agents see their own scope only' })
  getOverview(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Query() query: DateRangeQueryDto) {
    return this.analyticsService.getOverview(tenantId, user, query);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Conversation volume series, status/tag breakdown, busiest-hours heatmap' })
  getConversations(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Query() query: ConversationsQueryDto) {
    return this.analyticsService.getConversations(tenantId, user, query);
  }

  @Get('agents')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Per-agent performance table (admin/owner only)' })
  getAgentPerformance(@CurrentTenant() tenantId: string, @Query() query: DateRangeQueryDto) {
    return this.analyticsService.getAgentPerformance(tenantId, query);
  }
}
