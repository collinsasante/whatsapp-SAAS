import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExceptionStatus } from '@prisma/client';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';

@ApiTags('Commerce Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('commerce/exceptions')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get()
  @ApiOperation({ summary: 'List reconciliation exceptions' })
  findAll(@CurrentTenant() tenantId: string, @Query('status') status?: ExceptionStatus) {
    return this.reconciliationService.findAll(tenantId, status);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Mark a reconciliation exception resolved' })
  resolve(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body('resolutionNote') resolutionNote?: string,
  ) {
    return this.reconciliationService.resolve(tenantId, id, user.sub, resolutionNote);
  }
}
