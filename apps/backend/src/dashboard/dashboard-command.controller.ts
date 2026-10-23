import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { DashboardCommandService } from './dashboard-command.service';
import { DashboardRangeQueryDto } from './dto/dashboard-command.dto';

/**
 * Owner dashboard widgets. Admin/owner only: the tenant comes from the signed-in user's token and every widget
 * loads from its own endpoint so one failing query does not blank the page.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('dashboard/command')
export class DashboardCommandController {
  constructor(private readonly service: DashboardCommandService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline KPIs for the range with the previous equal-length period' })
  summary(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getSummary(tenantId, query);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Conversation and message volume over the range, plus channel split' })
  trend(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getTrend(tenantId, query);
  }

  @Get('attention')
  @ApiOperation({ summary: 'Items that need action now, each with a link to the matching view' })
  attention(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getAttention(tenantId, query);
  }

  @Get('team')
  @ApiOperation({ summary: 'Per-person workload and response times, and unassigned workload' })
  team(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getTeam(tenantId, query);
  }

  @Get('ai')
  @ApiOperation({ summary: 'Verz AI activity, handoffs and credit balance' })
  ai(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getAi(tenantId, query);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Recent conversation events (no message content)' })
  activity(@CurrentTenant() tenantId: string) {
    return this.service.getActivity(tenantId);
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Rules-based recommendations with the evidence behind each' })
  recommendations(@CurrentTenant() tenantId: string, @Query() query: DashboardRangeQueryDto) {
    return this.service.getRecommendations(tenantId, query);
  }
}
