import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommerceLedgerService } from './commerce-ledger.service';
import { RevenueSummaryService } from './revenue-summary.service';
import { RevenueRangeQueryDto } from './dto/revenue-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('Commerce Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('commerce/ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: CommerceLedgerService,
    private readonly revenueSummary: RevenueSummaryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Paginated take-rate ledger for this tenant, with running totals by entry type' })
  getLedger(
    @CurrentTenant() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('currency') currency?: string,
  ) {
    return this.ledgerService.getLedger(tenantId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      from,
      to,
      currency,
    });
  }

  @Get('summary')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Revenue for a period against the equal period before it: totals, daily series and sales by product, per currency' })
  getSummary(@CurrentTenant() tenantId: string, @Query() query: RevenueRangeQueryDto) {
    return this.revenueSummary.getSummary(tenantId, query);
  }
}
