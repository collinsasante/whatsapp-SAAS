import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { parseDateRange, parseTrendDays } from './date-range.util';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview stats' })
  getOverview(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getOverview(tenantId);
  }

  @Get('team')
  @ApiOperation({ summary: 'Get team member stats' })
  getTeam(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getTeamStats(tenantId);
  }

  @Get('conversation-trend')
  @ApiOperation({ summary: 'Get conversation trend for last N days' })
  getTrend(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.dashboardService.getConversationTrend(tenantId, parseTrendDays(days));
  }

  @Get('conversation-stats')
  @ApiOperation({ summary: 'Get opened/closed conversation counts for a date range' })
  getConversationStats(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = parseDateRange(from, to);
    return this.dashboardService.getConversationStats(tenantId, range.from, range.to);
  }

  @Get('message-volume')
  @ApiOperation({ summary: 'Daily inbound/outbound message counts for last N days' })
  getMessageVolume(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.dashboardService.getMessageVolume(tenantId, parseTrendDays(days));
  }

  @Get('response-time')
  @ApiOperation({ summary: 'Daily average first-response time for last N days' })
  getResponseTime(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.dashboardService.getResponseTimeStats(tenantId, parseTrendDays(days));
  }

  @Get('whatsapp-status')
  @ApiOperation({ summary: 'Get WhatsApp API connection status' })
  getWhatsAppStatus(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getWhatsAppStatus(tenantId);
  }

  @Get('business-profile')
  @ApiOperation({ summary: 'Get business profile from Meta API' })
  getBusinessProfile(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getBusinessProfile(tenantId);
  }
}
