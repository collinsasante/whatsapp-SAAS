import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { DashboardCommandService } from './dashboard-command.service';
import { DashboardRangeQueryDto, WhatsAppStatusQueryDto } from './dto/dashboard-command.dto';
import { DashboardAccountService } from './dashboard-account.service';

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
  constructor(
    private readonly service: DashboardCommandService,
    private readonly account: DashboardAccountService,
  ) {}

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

  @Get('requests')
  @ApiOperation({ summary: 'Conversations waiting for a person, how many are past the reply deadline, and the deadline in force' })
  requests(@CurrentTenant() tenantId: string) {
    return this.account.getRequests(tenantId);
  }

  @Get('business')
  @ApiOperation({ summary: 'Business information and account details for the workspace' })
  business(@CurrentTenant() tenantId: string) {
    return this.account.getBusiness(tenantId);
  }

  @Get('whatsapp-status')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Health of each connected WhatsApp number as reported by Meta (cached for a minute)' })
  whatsappStatus(@CurrentTenant() tenantId: string, @Query() query: WhatsAppStatusQueryDto) {
    return this.account.getWhatsAppStatus(tenantId, query.refresh === 'true');
  }
}
