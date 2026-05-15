import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/dashboard')
export class PlatformDashboardController {
  constructor(private service: PlatformAdminService) {}

  @Get('stats')
  getStats() {
    return this.service.getGlobalStats();
  }
}
