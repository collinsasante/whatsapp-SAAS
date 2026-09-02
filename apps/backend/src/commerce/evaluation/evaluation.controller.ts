import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole, JwtPayload } from '@whatsapp-platform/shared-types';
import { EvaluationRunService } from './evaluation-run.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';

/** Admin-only: a run costs real DeepSeek spend and writes production-shaped rows. */
@ApiTags('Commerce AI Evaluation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('commerce/evaluation')
export class EvaluationController {
  constructor(private readonly evaluationRunService: EvaluationRunService) {}

  @Post('runs')
  @ApiOperation({ summary: 'Trigger a new AI evaluation run (~15-20 scripted conversations against the real commerce AI, 1-3 min)' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.evaluationRunService.createRun(tenantId, user.sub);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List evaluation runs' })
  findAll(@CurrentTenant() tenantId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.evaluationRunService.findAll(tenantId, page ? parseInt(page, 10) : undefined, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get a run: overall verdict, per-criterion summary, case list' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.evaluationRunService.findOne(tenantId, id);
  }

  @Get('runs/:id/cases/:caseId')
  @ApiOperation({ summary: 'Full transcript for one case -- see why it passed or failed' })
  findCase(@CurrentTenant() tenantId: string, @Param('id') id: string, @Param('caseId') caseId: string) {
    return this.evaluationRunService.findCase(tenantId, id, caseId);
  }
}
