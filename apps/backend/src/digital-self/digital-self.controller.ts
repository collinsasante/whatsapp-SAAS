import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AuditService } from '../audit/audit.service';
import { DigitalSelfService } from './digital-self.service';
import { SetEnabledDto, SetLearningPausedDto, SetOverridesDto } from './dto';

/** Every query is scoped by the authenticated tenant; the tenant id is never taken from the request. Reads: agents and up (the conversation selector needs the list). Changes: admins. */
@ApiTags('Digital Self')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('digital-self')
export class DigitalSelfController {
  constructor(
    private readonly service: DigitalSelfService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: "List this workspace's agents' Digital Selves" })
  list(@CurrentTenant() tenantId: string) {
    return this.service.list(tenantId);
  }

  @Get(':id')
  @Roles(UserRole.AGENT)
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @Patch(':id/learning')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Pause or resume learning for one Digital Self' })
  async setLearning(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SetLearningPausedDto) {
    const view = await this.service.setLearningPaused(tenantId, id, dto.paused);
    await this.record(tenantId, user, id, { learningPaused: dto.paused });
    return view;
  }

  @Patch(':id/enabled')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate one Digital Self (a deactivated one cannot be assigned or used)' })
  async setEnabled(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SetEnabledDto) {
    const view = await this.service.setEnabled(tenantId, id, dto.enabled);
    await this.record(tenantId, user, id, { enabled: dto.enabled });
    return view;
  }

  @Put(':id/overrides')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Correct learned style traits (enumerated values only; null clears one)' })
  async setOverrides(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SetOverridesDto) {
    const view = await this.service.setOverrides(tenantId, id, dto);
    await this.record(tenantId, user, id, { overrides: dto });
    return view;
  }

  @Post(':id/reset')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Forget everything learned for this Digital Self' })
  async reset(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const view = await this.service.reset(tenantId, id);
    await this.record(tenantId, user, id, { reset: true });
    return view;
  }

  private record(tenantId: string, user: JwtPayload, id: string, change: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantId, userId: user.sub, action: AuditAction.UPDATE, resource: 'digital_self', resourceId: id, metadata: change });
  }
}
