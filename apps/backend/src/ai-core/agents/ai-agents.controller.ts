import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/shared-types';
import { AiAgentsService } from './ai-agents.service';
import { CreateAiAgentDto, UpdateAiAgentDto } from './dto/ai-agent.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('Verz-AI Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai/agents')
export class AiAgentsController {
  constructor(private readonly agentsService: AiAgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List this tenant\'s AI agents' })
  list(@CurrentTenant() tenantId: string) {
    return this.agentsService.list(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one AI agent' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.agentsService.findOne(tenantId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an AI agent (Phase 2+ fields accepted on the model but not yet read by the pipeline)' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateAiAgentDto) {
    return this.agentsService.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an AI agent' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateAiAgentDto) {
    return this.agentsService.update(tenantId, id, dto);
  }
}
