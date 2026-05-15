import {
  Controller, Get, Post, Patch, Delete, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';
import { ImpersonationService } from '../services/impersonation.service';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';
import { ListWorkspacesDto, SuspendWorkspaceDto, UpdateWorkspacePlanDto } from '../dto/workspace-action.dto';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/workspaces')
export class PlatformWorkspacesController {
  constructor(
    private service: PlatformAdminService,
    private impersonationService: ImpersonationService,
  ) {}

  @Get()
  list(@Query() query: ListWorkspacesDto) {
    return this.service.listWorkspaces(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getWorkspace(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param('id') id: string,
    @Body() dto: SuspendWorkspaceDto,
    @CurrentAdmin() admin: PlatformAdminPayload,
  ) {
    return this.service.suspendWorkspace(id, admin.sub, dto.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.reactivateWorkspace(id, admin.sub);
  }

  @Patch(':id/plan')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateWorkspacePlanDto,
    @CurrentAdmin() admin: PlatformAdminPayload,
  ) {
    return this.service.updateWorkspacePlan(id, dto.plan, admin.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.deleteWorkspace(id, admin.sub);
  }

  @Post(':id/impersonate')
  @HttpCode(HttpStatus.OK)
  impersonate(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.impersonationService.impersonate(id, admin.sub, admin.email);
  }
}
