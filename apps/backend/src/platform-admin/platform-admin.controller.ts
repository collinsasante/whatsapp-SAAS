import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PlatformAdminGuard, AdminRequest } from './platform-admin.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminAnalyticsService } from './platform-admin-analytics.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformHealthService } from './platform-health.service';
import { AiCreditsService } from '../ai-core/credits/ai-credits.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AiCreditTransactionType } from '@prisma/client';
import { RequirePlatformRole } from './decorators/require-platform-role.decorator';
import {
  AdminLoginDto, AdminSetupDto, AiCreditTransactionsQueryDto, AiCreditWalletsQueryDto, AuditLogsQueryDto,
  CreateAiCreditPackageDto, CreateAiPricingConfigDto, CreateFeatureFlagDto, CreatePlanDto,
  ErrorLogsQueryDto, FunnelQueryDto, GrantCreditsDto, InviteAdminDto, OrdersQueryDto, OverviewQueryDto,
  PaymentsQueryDto, RevenueQueryDto, SearchQueryDto, SetFlagRolloutDto, TenantsQueryDto,
  UpdateAdminRoleDto, UpdateAiCreditPackageDto, UpdateAiPricingConfigDto, UpdateCommerceFeeDefaultDto, UpdateErrorLogStatusDto,
  UpdateFeatureFlagDto, UpdatePlanDto, UpdateWorkspaceDto, UsageQueryDto, WebhookEventsQueryDto,
} from './dto/platform-admin.dto';

@ApiTags('Platform Admin')
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private authService: PlatformAdminAuthService,
    private adminService: PlatformAdminService,
    private analyticsService: PlatformAdminAnalyticsService,
    private auditService: PlatformAuditService,
    private healthService: PlatformHealthService,
    private aiCreditsService: AiCreditsService,
    private featureFlagsService: FeatureFlagsService,
  ) {}

  private auditMeta(req: AdminRequest) {
    return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Post('auth/setup')
  setup(@Body() dto: AdminSetupDto) {
    return this.authService.setup(dto);
  }

  @Post('auth/login')
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip);
  }

  @Get('admins')
  @UseGuards(PlatformAdminGuard)
  listAdmins() {
    return this.adminService.listAdmins();
  }

  @Post('admins')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async inviteAdmin(@Body() dto: InviteAdminDto, @Req() req: AdminRequest) {
    const result = await this.authService.inviteAdmin(dto);
    await this.auditService.log({ adminId: req.adminId, action: 'admin.invite', resourceType: 'PlatformAdmin', resourceId: result.id, metadata: { email: dto.email, role: dto.role }, ...this.auditMeta(req) });
    return result;
  }

  @Patch('admins/:id/role')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async updateAdminRole(@Param('id') id: string, @Body() dto: UpdateAdminRoleDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updateAdminRole(id, dto, req.adminId);
    await this.auditService.log({ adminId: req.adminId, action: 'admin.role_change', resourceType: 'PlatformAdmin', resourceId: id, metadata: { newRole: dto.role }, ...this.auditMeta(req) });
    return result;
  }

  // ── Monitoring: error logs ──────────────────────────────────────────────

  @Get('errors')
  @UseGuards(PlatformAdminGuard)
  listErrors(@Query() query: ErrorLogsQueryDto) {
    return this.adminService.listErrors(query);
  }

  @Get('errors/:id')
  @UseGuards(PlatformAdminGuard)
  getError(@Param('id') id: string) {
    return this.adminService.getError(id);
  }

  @Patch('errors/:id/status')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  async updateErrorStatus(@Param('id') id: string, @Body() dto: UpdateErrorLogStatusDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updateErrorStatus(id, dto);
    await this.auditService.log({ adminId: req.adminId, action: 'error_log.status_change', resourceType: 'ErrorLog', resourceId: id, metadata: { status: dto.status }, ...this.auditMeta(req) });
    return result;
  }

  // ── Monitoring: webhook events ──────────────────────────────────────────

  @Get('webhooks')
  @UseGuards(PlatformAdminGuard)
  listWebhookEvents(@Query() query: WebhookEventsQueryDto) {
    return this.adminService.listWebhookEvents(query);
  }

  @Get('webhooks/:id')
  @UseGuards(PlatformAdminGuard)
  getWebhookEvent(@Param('id') id: string) {
    return this.adminService.getWebhookEvent(id);
  }

  @Post('webhooks/:id/reprocess')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async reprocessWebhookEvent(@Param('id') id: string, @Req() req: AdminRequest) {
    const result = await this.adminService.reprocessWebhookEvent(id);
    await this.auditService.log({ adminId: req.adminId, action: 'webhook_event.reprocess', resourceType: 'WebhookEvent', resourceId: id, metadata: result, ...this.auditMeta(req) });
    return result;
  }

  // ── AI analytics ─────────────────────────────────────────────────────────

  @Get('analytics/ai')
  @UseGuards(PlatformAdminGuard)
  getAiAnalytics(@Query() query: UsageQueryDto) {
    return this.analyticsService.getAiAnalytics(query.from, query.to);
  }

  @Get('ai/usage')
  @UseGuards(PlatformAdminGuard)
  getAiUsageTopConsumers(@Query() query: UsageQueryDto) {
    return this.analyticsService.getAiUsageTopConsumers(query.from, query.to);
  }

  @Get('ai/credits/wallets')
  @UseGuards(PlatformAdminGuard)
  getAiCreditWallets(@Query() query: AiCreditWalletsQueryDto) {
    return this.analyticsService.getAiCreditWallets(query);
  }

  @Get('ai/credits/transactions')
  @UseGuards(PlatformAdminGuard)
  getAiCreditTransactions(@Query() query: AiCreditTransactionsQueryDto) {
    return this.aiCreditsService.adminListTransactions({
      tenantId: query.tenantId,
      type: query.type as AiCreditTransactionType | undefined,
      limit: query.limit,
      offset: query.offset,
    });
  }

  // ── Commerce analytics ───────────────────────────────────────────────────

  @Get('analytics/commerce')
  @UseGuards(PlatformAdminGuard)
  getCommerceAnalytics(@Query() query: UsageQueryDto) {
    return this.analyticsService.getCommerceAnalytics(query.from, query.to);
  }

  @Get('orders')
  @UseGuards(PlatformAdminGuard)
  listOrders(@Query() query: OrdersQueryDto) {
    return this.analyticsService.listOrders(query);
  }

  @Get('orders/:id')
  @UseGuards(PlatformAdminGuard)
  getOrder(@Param('id') id: string) {
    return this.analyticsService.getOrder(id);
  }

  @Get('commerce/fees')
  @UseGuards(PlatformAdminGuard)
  getCommerceFees(@Query() query: UsageQueryDto) {
    return this.analyticsService.getCommerceFees(query.from, query.to);
  }

  // ── Messaging analytics ──────────────────────────────────────────────────

  @Get('analytics/messaging')
  @UseGuards(PlatformAdminGuard)
  getMessagingAnalytics(@Query() query: UsageQueryDto) {
    return this.analyticsService.getMessagingAnalytics(query.from, query.to);
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  @Get('payments')
  @UseGuards(PlatformAdminGuard)
  listPayments(@Query() query: PaymentsQueryDto) {
    return this.analyticsService.listPayments(query);
  }

  // ── Audit logs ───────────────────────────────────────────────────────────

  @Get('audit-logs')
  @UseGuards(PlatformAdminGuard)
  listAuditLogs(@Query() query: AuditLogsQueryDto) {
    return this.analyticsService.listAuditLogs(query);
  }

  // ── Feature flags ────────────────────────────────────────────────────────

  @Get('feature-flags')
  @UseGuards(PlatformAdminGuard)
  listFeatureFlags() {
    return this.featureFlagsService.list();
  }

  @Post('feature-flags')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async createFeatureFlag(@Body() dto: CreateFeatureFlagDto, @Req() req: AdminRequest) {
    const result = await this.featureFlagsService.create(dto);
    await this.auditService.log({ adminId: req.adminId, action: 'feature_flag.create', resourceType: 'FeatureFlag', resourceId: result.id, metadata: { key: dto.key }, ...this.auditMeta(req) });
    return result;
  }

  @Patch('feature-flags/:id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async updateFeatureFlag(@Param('id') id: string, @Body() dto: UpdateFeatureFlagDto, @Req() req: AdminRequest) {
    const result = await this.featureFlagsService.update(id, dto);
    await this.auditService.log({ adminId: req.adminId, action: 'feature_flag.update', resourceType: 'FeatureFlag', resourceId: id, metadata: dto, ...this.auditMeta(req) });
    return result;
  }

  @Patch('feature-flags/:id/rollout/:tenantId')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async setFeatureFlagRollout(@Param('id') id: string, @Param('tenantId') tenantId: string, @Body() dto: SetFlagRolloutDto, @Req() req: AdminRequest) {
    const result = await this.featureFlagsService.setTenantRollout(id, tenantId, dto.enabled);
    await this.auditService.log({ adminId: req.adminId, action: 'feature_flag.rollout_change', resourceType: 'FeatureFlag', resourceId: id, metadata: { tenantId, enabled: dto.enabled }, ...this.auditMeta(req) });
    return result;
  }

  // ── Global search ────────────────────────────────────────────────────────

  @Get('search')
  @UseGuards(PlatformAdminGuard)
  search(@Query() query: SearchQueryDto) {
    return this.analyticsService.search(query.q);
  }

  @Post('auth/forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email).then(() => ({ message: 'If that email exists, a reset link has been sent.' }));
  }

  @Post('auth/reset-password')
  resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body.token, body.password);
  }

  @Get('auth/me')
  @UseGuards(PlatformAdminGuard)
  me(@Req() req: AdminRequest) {
    return this.authService.me(req.adminId);
  }

  @Get('dashboard')
  @UseGuards(PlatformAdminGuard)
  dashboard() {
    return this.adminService.getDashboard();
  }

  @Get('overview')
  @UseGuards(PlatformAdminGuard)
  overview(@Query() query: OverviewQueryDto) {
    return this.adminService.getOverview(query.from, query.to);
  }

  @Get('revenue')
  @UseGuards(PlatformAdminGuard)
  revenue(@Query() query: RevenueQueryDto) {
    return this.adminService.getRevenue(query.from, query.to);
  }

  @Get('funnel')
  @UseGuards(PlatformAdminGuard)
  funnel(@Query() query: FunnelQueryDto) {
    return this.adminService.getFunnel(query.from, query.to);
  }

  @Get('usage')
  @UseGuards(PlatformAdminGuard)
  usage(@Query() query: UsageQueryDto) {
    return this.adminService.getUsage(query.from, query.to);
  }

  @Get('platform-health')
  @UseGuards(PlatformAdminGuard)
  platformHealth() {
    return this.healthService.getPlatformHealth();
  }

  @Get('workspaces')
  @UseGuards(PlatformAdminGuard)
  workspaces(@Query() query: TenantsQueryDto) {
    return this.adminService.getTenantsTable(query);
  }

  // Must be registered before 'workspaces/:id' -- otherwise Nest matches
  // "export" as the :id param and this route is never reached.
  @Get('workspaces/export')
  @UseGuards(PlatformAdminGuard)
  async exportWorkspacesCsv(@Query() query: TenantsQueryDto, @Res() res: Response) {
    const csv = await this.adminService.exportTenantsCsv(query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tenants-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('workspaces/:id')
  @UseGuards(PlatformAdminGuard)
  workspace(@Param('id') id: string) {
    return this.adminService.getWorkspace(id);
  }

  @Patch('workspaces/:id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  async updateWorkspace(@Param('id') id: string, @Body() data: UpdateWorkspaceDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updateWorkspace(id, data);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.update', resourceType: 'Tenant', resourceId: id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Patch('workspaces/:id/suspend')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  async suspendWorkspace(@Param('id') id: string, @Req() req: AdminRequest) {
    const result = await this.adminService.suspendWorkspace(id);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.suspend', resourceType: 'Tenant', resourceId: id, ...this.auditMeta(req) });
    return result;
  }

  @Patch('workspaces/:id/activate')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  async activateWorkspace(@Param('id') id: string, @Req() req: AdminRequest) {
    const result = await this.adminService.activateWorkspace(id);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.activate', resourceType: 'Tenant', resourceId: id, ...this.auditMeta(req) });
    return result;
  }

  @Get('billing/invoices')
  @UseGuards(PlatformAdminGuard)
  allInvoices(@Query('page') page: string, @Query('limit') limit: string) {
    return this.adminService.getAllInvoices(+page || 1, +limit || 20);
  }

  @Get('plans')
  @UseGuards(PlatformAdminGuard)
  plans() {
    return this.adminService.getPlans();
  }

  @Post('plans')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async createPlan(@Body() data: CreatePlanDto, @Req() req: AdminRequest) {
    const result = await this.adminService.createPlan(data);
    await this.auditService.log({ adminId: req.adminId, action: 'plan.create', resourceType: 'Plan', resourceId: result.id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Patch('plans/:id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async updatePlan(@Param('id') id: string, @Body() data: UpdatePlanDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updatePlan(id, data);
    await this.auditService.log({ adminId: req.adminId, action: 'plan.update', resourceType: 'Plan', resourceId: id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Patch('workspaces/:id/force-plan')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async forceSubscription(@Param('id') id: string, @Body('planSlug') planSlug: string, @Req() req: AdminRequest) {
    const result = await this.adminService.forceSubscription(id, planSlug);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.force_plan', resourceType: 'Tenant', resourceId: id, metadata: { planSlug }, ...this.auditMeta(req) });
    return result;
  }

  @Patch('workspaces/:id/commerce')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async setCommerceConfig(
    @Param('id') id: string,
    @Body('commerceEnabled') commerceEnabled: boolean,
    @Body('takeRatePct') takeRatePct: number,
    @Req() req: AdminRequest,
  ) {
    const result = await this.adminService.setCommerceConfig(id, commerceEnabled, takeRatePct);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.set_commerce_config', resourceType: 'Tenant', resourceId: id, metadata: { commerceEnabled, takeRatePct }, ...this.auditMeta(req) });
    return result;
  }

  // ── Verz AI Credits admin config ────────────────────────────────────────

  @Get('ai/pricing')
  @UseGuards(PlatformAdminGuard)
  listAiPricingConfigs() {
    return this.adminService.listAiPricingConfigs();
  }

  @Post('ai/pricing')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async createAiPricingConfig(@Body() data: CreateAiPricingConfigDto, @Req() req: AdminRequest) {
    const result = await this.adminService.createAiPricingConfig(data);
    await this.auditService.log({ adminId: req.adminId, action: 'ai_pricing.create', resourceType: 'AiPricingConfig', resourceId: result.id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Patch('ai/pricing/:id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async updateAiPricingConfig(@Param('id') id: string, @Body() data: UpdateAiPricingConfigDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updateAiPricingConfig(id, data);
    await this.auditService.log({ adminId: req.adminId, action: 'ai_pricing.update', resourceType: 'AiPricingConfig', resourceId: id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Get('ai/credit-packages')
  @UseGuards(PlatformAdminGuard)
  listAiCreditPackages() {
    return this.adminService.listAiCreditPackages();
  }

  @Post('ai/credit-packages')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async createAiCreditPackage(@Body() data: CreateAiCreditPackageDto, @Req() req: AdminRequest) {
    const result = await this.adminService.createAiCreditPackage(data);
    await this.auditService.log({ adminId: req.adminId, action: 'ai_credit_package.create', resourceType: 'AiCreditPackage', resourceId: result.id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Patch('ai/credit-packages/:id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async updateAiCreditPackage(@Param('id') id: string, @Body() data: UpdateAiCreditPackageDto, @Req() req: AdminRequest) {
    const result = await this.adminService.updateAiCreditPackage(id, data);
    await this.auditService.log({ adminId: req.adminId, action: 'ai_credit_package.update', resourceType: 'AiCreditPackage', resourceId: id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Get('settings/commerce-fee')
  @UseGuards(PlatformAdminGuard)
  getDefaultCommerceFeePct() {
    return this.adminService.getDefaultCommerceFeePct();
  }

  @Patch('settings/commerce-fee')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async setDefaultCommerceFeePct(@Body() data: UpdateCommerceFeeDefaultDto, @Req() req: AdminRequest) {
    const result = await this.adminService.setDefaultCommerceFeePct(data, req.adminId);
    await this.auditService.log({ adminId: req.adminId, action: 'settings.set_default_commerce_fee', resourceType: 'PlatformSettings', resourceId: 'default_commerce_fee_pct', metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Post('workspaces/:id/credits/grant')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  async grantCredits(@Param('id') id: string, @Body() data: GrantCreditsDto, @Req() req: AdminRequest) {
    const result = await this.adminService.grantCredits(id, data);
    await this.auditService.log({ adminId: req.adminId, action: 'workspace.grant_credits', resourceType: 'Tenant', resourceId: id, metadata: data, ...this.auditMeta(req) });
    return result;
  }

  @Get('workspaces/:id/templates')
  @UseGuards(PlatformAdminGuard)
  workspaceTemplates(@Param('id') id: string) {
    return this.adminService.getWorkspaceTemplates(id);
  }

  @Get('users')
  @UseGuards(PlatformAdminGuard)
  users(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.adminService.getUsers(+page || 1, +limit || 30, search, tenantId);
  }

  @Patch('users/:id/toggle-active')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  async toggleUserActive(@Param('id') id: string, @Req() req: AdminRequest) {
    const result = await this.adminService.toggleUserActive(id);
    await this.auditService.log({ adminId: req.adminId, action: 'user.toggle_active', resourceType: 'User', resourceId: id, metadata: { isActive: result.isActive }, ...this.auditMeta(req) });
    return result;
  }
}
