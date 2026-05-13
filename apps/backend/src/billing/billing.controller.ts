import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get current plan and billing status' })
  getStatus(@CurrentTenant() tenantId: string) {
    return this.billingService.getStatus(tenantId);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get usage stats for current billing cycle' })
  getUsage(@CurrentTenant() tenantId: string) {
    return this.billingService.getUsage(tenantId);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Get invoice history' })
  getInvoices(@CurrentTenant() tenantId: string) {
    return this.billingService.getInvoices(tenantId);
  }

  @Post('upgrade')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Upgrade or change plan' })
  upgradePlan(@CurrentTenant() tenantId: string, @Body() body: { plan: string }) {
    return this.billingService.upgradePlan(tenantId, body.plan);
  }

  @Patch('email')
  @Roles(UserRole.ADMIN)
  updateBillingEmail(@CurrentTenant() tenantId: string, @Body() body: { billingEmail: string }) {
    return this.billingService.updateBillingEmail(tenantId, body.billingEmail);
  }
}
