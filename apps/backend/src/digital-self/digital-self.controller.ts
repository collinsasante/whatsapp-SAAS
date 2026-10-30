import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { DIGITAL_SELF_FLAG_KEY } from './digital-self-learning.trigger';
import { DigitalSelfService } from './digital-self.service';
import { MIN_ATTRIBUTE_SAMPLES, READY_SAMPLES } from './digital-self.constants';
import { AssignDigitalSelfDto, SetEnabledDto, SetLearningPausedDto, SetOverridesDto } from './dto';

/** Every query is scoped by the authenticated tenant; the tenant id is never taken from the request. Reads: agents and up (the conversation selector needs the list). Changes: admins. */
@ApiTags('Digital Self')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('digital-self')
export class DigitalSelfController {
  constructor(
    private readonly service: DigitalSelfService,
    private readonly audit: AuditService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get()
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: "List this workspace's agents' Digital Selves" })
  async list(@CurrentTenant() tenantId: string) {
    const [items, featureEnabled] = await Promise.all([this.service.list(tenantId), this.featureFlags.isEnabledCached(DIGITAL_SELF_FLAG_KEY, tenantId)]);
    // featureEnabled tells the UI whether learning and styling are actually switched on for this workspace; profiles exist either way.
    return { featureEnabled, thresholds: { minAttributeSamples: MIN_ATTRIBUTE_SAMPLES, readySamples: READY_SAMPLES }, items };
  }

  @Get('conversations/:conversationId')
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: 'Which Digital Self represents this conversation' })
  forConversation(@CurrentTenant() tenantId: string, @Param('conversationId') conversationId: string) {
    return this.service.getForConversation(tenantId, conversationId);
  }

  @Put('conversations/:conversationId')
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: "Assign, change or remove a conversation's Digital Self. Never changes human ownership or enables AI replies." })
  async assign(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('conversationId') conversationId: string, @Body() dto: AssignDigitalSelfDto) {
    const result = await this.service.assignToConversation(tenantId, conversationId, dto.digitalSelfId ?? null, { id: user.sub, role: user.role });
    await this.audit.log({ tenantId, userId: user.sub, action: AuditAction.UPDATE, resource: 'conversation_digital_self', resourceId: conversationId, metadata: { digitalSelfId: dto.digitalSelfId ?? null } });
    return result;
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
