import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalTasksService } from './internal-tasks.service';
import { UpdateTaskStatusDto, AssignTaskDto } from './dto/internal-task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Internal Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('internal-tasks')
export class InternalTasksController {
  constructor(private readonly tasksService: InternalTasksService) {}

  @Get()
  @ApiOperation({ summary: 'List internal tasks for this tenant, optionally filtered' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tasksService.findAll(tenantId, { status, department, assigneeId, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single internal task' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.tasksService.findOne(tenantId, id);
  }

  @Patch(':id/status')
  @Roles(UserRole.AGENT) // viewers are read-only
  @ApiOperation({ summary: 'Update a task\'s status -- resolving to DONE/CANCELLED records who resolved it' })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.updateStatus(tenantId, id, dto.status, user.sub);
  }

  @Patch(':id/assign')
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: 'Assign a task to a team member (agents: themselves only; admins: anyone)' })
  assign(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: AssignTaskDto, @CurrentUser() user: JwtPayload) {
    return this.tasksService.assign(tenantId, id, dto.assigneeId, { userId: user.sub, role: user.role });
  }
}
