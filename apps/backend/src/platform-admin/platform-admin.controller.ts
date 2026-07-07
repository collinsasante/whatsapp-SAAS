import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PlatformAdminGuard, AdminRequest } from './platform-admin.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditService } from './platform-audit.service';
import { RequirePlatformRole } from './decorators/require-platform-role.decorator';
import { AdminLoginDto, AdminSetupDto, CreatePlanDto, UpdatePlanDto, UpdateWorkspaceDto } from './dto/platform-admin.dto';

@ApiTags('Platform Admin')
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private authService: PlatformAdminAuthService,
    private adminService: PlatformAdminService,
    private auditService: PlatformAuditService,
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

  @Get('workspaces')
  @UseGuards(PlatformAdminGuard)
  workspaces(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getWorkspaces(+page || 1, +limit || 20, search);
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

  @Get('workspaces/:id/templates')
  @UseGuards(PlatformAdminGuard)
  workspaceTemplates(@Param('id') id: string) {
    return this.adminService.getWorkspaceTemplates(id);
  }

  @Get('users')
  @UseGuards(PlatformAdminGuard)
  users(@Query('page') page: string, @Query('limit') limit: string, @Query('search') search?: string) {
    return this.adminService.getUsers(+page || 1, +limit || 30, search);
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
