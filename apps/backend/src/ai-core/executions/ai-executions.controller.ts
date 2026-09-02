import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/shared-types';
import { AiExecutionsService } from './ai-executions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

/** Admin-only: execution traces can carry tokens/cost/prompt internals. */
@ApiTags('Verz-AI Executions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('ai/executions')
export class AiExecutionsController {
  constructor(private readonly executions: AiExecutionsService) {}

  @Get()
  @ApiOperation({ summary: 'List AI execution traces for this tenant' })
  list(
    @CurrentTenant() tenantId: string,
    @Query('conversationId') conversationId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.executions.list(tenantId, { conversationId, status, cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full trace for one execution -- stage timings, tokens, cost, linked interaction log' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.executions.findOne(tenantId, id);
  }
}
