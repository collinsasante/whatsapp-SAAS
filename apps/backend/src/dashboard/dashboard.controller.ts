import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

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
    return this.dashboardService.getConversationTrend(tenantId, days ? parseInt(days, 10) : 14);
  }

  @Get('conversation-stats')
  @ApiOperation({ summary: 'Get opened/closed conversation counts for a date range' })
  getConversationStats(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : (() => { const d = new Date(toDate); d.setDate(d.getDate() - 30); return d; })();
    return this.dashboardService.getConversationStats(tenantId, fromDate, toDate);
  }

  @Get('whatsapp-status')
  @ApiOperation({ summary: 'Get WhatsApp API connection status' })
  getWhatsAppStatus(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getWhatsAppStatus(tenantId);
  }
}
