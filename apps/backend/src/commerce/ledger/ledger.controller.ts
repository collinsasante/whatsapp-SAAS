import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommerceLedgerService } from './commerce-ledger.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('Commerce Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('commerce/ledger')
export class LedgerController {
  constructor(private readonly ledgerService: CommerceLedgerService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated take-rate ledger for this tenant, with running totals by entry type' })
  getLedger(@CurrentTenant() tenantId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ledgerService.getLedger(tenantId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
