import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard, AdminRequest } from '../../platform-admin/platform-admin.guard';
import { RequirePlatformRole } from '../../platform-admin/decorators/require-platform-role.decorator';
import { PlatformAuditService } from '../../platform-admin/platform-audit.service';
import { WebhookSecurityAdminService } from './webhook-security-admin.service';
import { DiscoverDto, MapWabaDto, SummaryQueryDto, UpsertMetaAppDto } from './webhook-security.dto';

/**
 * Platform-admin surface for WhatsApp webhook signing: the Meta app registry, the WABA mapping, and the evidence for enforcing. Reading is open to
 * any platform admin; every change is SUPER_ADMIN only and audit-logged WITHOUT the secret. No response ever contains a secret or an access token.
 */
@Controller('platform-admin/whatsapp-webhook-security')
@UseGuards(PlatformAdminGuard)
export class WebhookSecurityAdminController {
  constructor(private readonly admin: WebhookSecurityAdminService, private readonly audit: PlatformAuditService) {}

  private meta(req: AdminRequest) {
    return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('apps')
  listApps() {
    return this.admin.listApps();
  }

  @Put('apps/:appId')
  @RequirePlatformRole('SUPER_ADMIN')
  async upsertApp(@Param('appId') appId: string, @Body() dto: UpsertMetaAppDto, @Req() req: AdminRequest) {
    const view = await this.admin.upsertApp(appId, dto);
    await this.audit.log({ adminId: req.adminId, action: 'whatsapp_app.upsert', resourceType: 'WhatsappMetaApp', resourceId: appId, metadata: { label: dto.label, status: dto.status ?? null, secretChanged: dto.secret !== undefined, fingerprint: view.secretFingerprint }, ...this.meta(req) });
    return view;
  }

  @Post('apps/:appId/mappings')
  @RequirePlatformRole('SUPER_ADMIN')
  async mapWaba(@Param('appId') appId: string, @Body() dto: MapWabaDto, @Req() req: AdminRequest) {
    const mapping = await this.admin.mapWaba(appId, dto.tenantId, dto.wabaId);
    await this.audit.log({ adminId: req.adminId, action: 'whatsapp_app.map_waba', resourceType: 'WhatsappWabaApp', resourceId: mapping.id, metadata: { appId, tenantId: dto.tenantId, wabaId: dto.wabaId }, ...this.meta(req) });
    return mapping;
  }

  @Delete('mappings/:mappingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePlatformRole('SUPER_ADMIN')
  async unmap(@Param('mappingId') mappingId: string, @Req() req: AdminRequest) {
    await this.admin.unmap(mappingId);
    await this.audit.log({ adminId: req.adminId, action: 'whatsapp_app.unmap_waba', resourceType: 'WhatsappWabaApp', resourceId: mappingId, metadata: {}, ...this.meta(req) });
  }

  @Get('summary')
  summary(@Query() query: SummaryQueryDto) {
    return this.admin.summary(query.days ?? 7, query.minValid ?? 10);
  }

  @Post('discover')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformRole('SUPER_ADMIN')
  async discover(@Body() dto: DiscoverDto, @Req() req: AdminRequest) {
    const result = await this.admin.discover(dto.tenantId, dto.apply === true);
    await this.audit.log({ adminId: req.adminId, action: 'whatsapp_app.discover', resourceType: 'WhatsappWabaApp', resourceId: dto.tenantId ?? 'all', metadata: { apply: dto.apply === true, lookedUp: result.lookedUp }, ...this.meta(req) });
    return result;
  }
}
