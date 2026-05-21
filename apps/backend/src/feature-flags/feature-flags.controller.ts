import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, Query,
} from '@nestjs/common';
import { FeatureFlagsService, CreateFlagDto, UpdateFlagDto } from './feature-flags.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly svc: FeatureFlagsService) {}

  // Tenant endpoint — get all flags evaluated for the caller's workspace
  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyFlags(@CurrentTenant() tenantId: string) {
    return this.svc.getForTenant(tenantId);
  }

  // Platform-admin endpoints
  @UseGuards(PlatformAdminGuard)
  @Get()
  list() {
    return this.svc.list();
  }

  @UseGuards(PlatformAdminGuard)
  @Post()
  create(@Body() dto: CreateFlagDto) {
    return this.svc.create(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFlagDto) {
    return this.svc.update(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @UseGuards(PlatformAdminGuard)
  @Get(':id/rollouts')
  getRollouts(@Param('id') id: string) {
    return this.svc.getTenantRollouts(id);
  }

  @UseGuards(PlatformAdminGuard)
  @Post(':id/rollouts')
  setRollout(
    @Param('id') flagId: string,
    @Body() body: { tenantId: string; enabled: boolean },
  ) {
    return this.svc.setTenantRollout(flagId, body.tenantId, body.enabled);
  }

  @UseGuards(PlatformAdminGuard)
  @Delete(':id/rollouts/:tenantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRollout(@Param('id') flagId: string, @Param('tenantId') tenantId: string) {
    return this.svc.removeTenantRollout(flagId, tenantId);
  }

  // Public: check a single flag for a tenant (no auth — used by webhooks/workers)
  @Get('check')
  checkFlag(@Query('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.svc.isEnabled(key, tenantId).then((enabled) => ({ key, enabled }));
  }
}
