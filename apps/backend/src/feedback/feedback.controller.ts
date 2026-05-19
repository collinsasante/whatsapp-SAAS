import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@ApiTags('Feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly svc: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit feedback' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.svc.create(tenantId, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List feedback (admin/owner only)' })
  list(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.svc.list(tenantId, Number(page), Number(limit));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update feedback status' })
  updateStatus(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @Body('status') status: string,
  ) {
    return this.svc.updateStatus(id, tenantId, status);
  }
}
