import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/analytics')
export class PlatformAnalyticsController {
  constructor(private service: PlatformAdminService) {}

  @Get()
  getAnalytics(@Query('days') days?: string) {
    return this.service.getGrowthAnalytics(days ? parseInt(days, 10) : 30);
  }
}
