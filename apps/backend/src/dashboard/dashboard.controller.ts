import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Batched home dashboard payload -- needs attention, today, health, activity, campaigns, setup checklist' })
  getDashboard(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.dashboardService.getDashboard(tenantId, user);
  }

  @Get('business-profile')
  @ApiOperation({ summary: 'Live Meta Business Profile data (name, about, address, email, website, quality rating) -- fetched separately from the main dashboard payload since it depends on an external API call' })
  getBusinessProfile(@CurrentTenant() tenantId: string) {
    return this.dashboardService.getBusinessProfile(tenantId);
  }
}
