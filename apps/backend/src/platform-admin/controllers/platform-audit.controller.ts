import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAuditService } from '../services/platform-audit.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/audit')
export class PlatformAuditController {
  constructor(private auditService: PlatformAuditService) {}

  @Get()
  getLogs(
    @Query('action') action?: string,
    @Query('adminId') adminId?: string,
    @Query('resourceType') resourceType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.list({
      action,
      adminId,
      resourceType,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
