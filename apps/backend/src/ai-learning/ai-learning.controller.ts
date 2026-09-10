import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { EvalQualityStatus, FailureCategory, TrainingExampleStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AiLearningService } from './ai-learning.service';
import { SubmitFeedbackDto, RecordCorrectionDto, SetTrainingExampleStatusDto } from './dto/ai-learning.dto';

/** Admin-only: interaction evaluations carry customer conversation content. */
@ApiTags('AI Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('ai-learning')
export class AiLearningController {
  constructor(private readonly service: AiLearningService) {}

  @Get('overview')
  @ApiOperation({ summary: 'AI Learning quality metrics for this tenant over a time window' })
  overview(@CurrentTenant() tenantId: string, @Query('hours') hours?: string) {
    return this.service.overview(tenantId, hours ? parseInt(hours, 10) : undefined);
  }

  @Get('interactions')
  @ApiOperation({ summary: 'List evaluated AI interactions for this tenant' })
  listInteractions(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: EvalQualityStatus,
    @Query('severity') severity?: string,
    @Query('failureCategory') failureCategory?: FailureCategory,
    @Query('conversationId') conversationId?: string,
    @Query('needsHumanReview') needsHumanReview?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listInteractions(tenantId, {
      status, severity, failureCategory, conversationId,
      needsHumanReview: needsHumanReview === undefined ? undefined : needsHumanReview === 'true',
      cursor, limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('interactions/:id')
  @ApiOperation({ summary: 'Full detail for one evaluated interaction -- execution, tool trace, feedback, corrections, training examples' })
  getInteraction(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getInteraction(tenantId, id);
  }

  @Post('interactions/:id/feedback')
  @ApiOperation({ summary: 'Submit human feedback (good/bad, reason, expected action/response) for one evaluation' })
  submitFeedback(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: SubmitFeedbackDto) {
    return this.service.submitFeedback(tenantId, id, { reviewerId: user.sub, ...dto });
  }

  @Post('interactions/:id/corrections')
  @ApiOperation({ summary: 'Record that a customer follow-up message corrected/clarified this AI turn' })
  recordCorrection(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RecordCorrectionDto) {
    return this.service.recordCorrection(tenantId, id, { reviewerId: user.sub, ...dto });
  }

  @Post('interactions/:id/training-example')
  @ApiOperation({ summary: 'Create a training example from a reviewed evaluation (requires feedback with expected action/response already submitted)' })
  createTrainingExample(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.createTrainingExample(tenantId, id, user.sub);
  }

  @Get('training-examples')
  @ApiOperation({ summary: 'List training examples, optionally filtered by status' })
  listTrainingExamples(@CurrentTenant() tenantId: string, @Query('status') status?: TrainingExampleStatus) {
    return this.service.listTrainingExamples(tenantId, status);
  }

  @Patch('training-examples/:id/status')
  @ApiOperation({ summary: 'Approve/reject/archive a training example' })
  setTrainingExampleStatus(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: SetTrainingExampleStatusDto) {
    return this.service.setTrainingExampleStatus(tenantId, id, dto.status, user.sub);
  }

  @Post('training-examples/:id/regression-case')
  @ApiOperation({ summary: 'Mark that this APPROVED training example was manually promoted into the regression evaluation scenario set' })
  markRegressionCaseCreated(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.markRegressionCaseCreated(tenantId, id, user.sub);
  }

  @Get('failures')
  @ApiOperation({ summary: 'Interactions currently needing human review, worst severity first' })
  listFailures(@CurrentTenant() tenantId: string) {
    return this.service.listFailures(tenantId);
  }

  @Get('corrections')
  @ApiOperation({ summary: 'Recorded customer corrections' })
  listCorrections(@CurrentTenant() tenantId: string) {
    return this.service.listCorrections(tenantId);
  }
}
