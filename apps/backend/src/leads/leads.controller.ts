import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get the current lead score/status for a conversation, if it has been scored' })
  getForConversation(@CurrentTenant() tenantId: string, @Param('conversationId') conversationId: string) {
    return this.leadsService.getForConversation(tenantId, conversationId);
  }

  @Post('conversation/:conversationId/rescore')
  @ApiOperation({ summary: 'Force a fresh lead-scoring pass for a conversation, bypassing the background throttle' })
  rescore(@CurrentTenant() tenantId: string, @Param('conversationId') conversationId: string) {
    return this.leadsService.rescore(tenantId, conversationId);
  }
}
