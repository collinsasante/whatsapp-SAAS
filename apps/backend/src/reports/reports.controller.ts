import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('contacts')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Export all contacts as CSV' })
  async exportContacts(
    @CurrentTenant() tenantId: string,
    @Res() res: Response,
    @Query('label') label?: string,
  ) {
    const csv = await this.reportsService.exportContacts(tenantId, label);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('campaigns')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Export campaign performance as CSV' })
  async exportCampaigns(
    @CurrentTenant() tenantId: string,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportCampaigns(tenantId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="campaigns-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('conversations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Export resolved conversations as CSV' })
  async exportConversations(
    @CurrentTenant() tenantId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
    const toDate = to ? new Date(to) : new Date();
    const csv = await this.reportsService.exportConversations(tenantId, fromDate, toDate);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="conversations-${Date.now()}.csv"`);
    res.send(csv);
  }
}
