import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { AdminLoginDto, AdminSetupDto, UpdatePlanDto } from './dto/platform-admin.dto';

type AdminRequest = Request & { adminId: string };

@ApiTags('Platform Admin')
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private authService: PlatformAdminAuthService,
    private adminService: PlatformAdminService,
  ) {}

  @Post('auth/setup')
  setup(@Body() dto: AdminSetupDto) {
    return this.authService.setup(dto);
  }

  @Post('auth/login')
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip);
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

  @Patch('workspaces/:id/suspend')
  @UseGuards(PlatformAdminGuard)
  suspendWorkspace(@Param('id') id: string) {
    return this.adminService.suspendWorkspace(id);
  }

  @Patch('workspaces/:id/activate')
  @UseGuards(PlatformAdminGuard)
  activateWorkspace(@Param('id') id: string) {
    return this.adminService.activateWorkspace(id);
  }

  @Get('billing/pending')
  @UseGuards(PlatformAdminGuard)
  pendingBilling() {
    return this.adminService.getPendingBilling();
  }

  @Get('billing/invoices')
  @UseGuards(PlatformAdminGuard)
  allInvoices(@Query('page') page: string, @Query('limit') limit: string) {
    return this.adminService.getAllInvoices(+page || 1, +limit || 20);
  }

  @Post('billing/activate')
  @UseGuards(PlatformAdminGuard)
  activateSubscription(@Body('reference') reference: string) {
    return this.adminService.activateSubscription(reference);
  }

  @Post('billing/activate-credits')
  @UseGuards(PlatformAdminGuard)
  activateCredits(@Body('reference') reference: string) {
    return this.adminService.activateCredits(reference);
  }

  @Get('plans')
  @UseGuards(PlatformAdminGuard)
  plans() {
    return this.adminService.getPlans();
  }

  @Patch('plans/:id')
  @UseGuards(PlatformAdminGuard)
  updatePlan(@Param('id') id: string, @Body() data: UpdatePlanDto) {
    return this.adminService.updatePlan(id, data);
  }
}
