import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ApplyPromoCodeDto, CancelSubscriptionDto, InitiateCheckoutDto, InitiateCreditCheckoutDto, UpdateBillingEmailDto } from './dto/billing.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get subscription status and plan' })
  getStatus(@CurrentTenant() tenantId: string) {
    return this.billingService.getStatus(tenantId);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get all available plans' })
  getPlans() {
    return this.billingService.getPlans();
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get live usage for current billing cycle' })
  getUsage(@CurrentTenant() tenantId: string) {
    return this.billingService.getUsage(tenantId);
  }

  @Get('usage/history')
  @ApiOperation({ summary: 'Get historical usage snapshots' })
  getUsageHistory(@CurrentTenant() tenantId: string) {
    return this.billingService.getUsageHistory(tenantId);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Get invoice history' })
  getInvoices(@CurrentTenant() tenantId: string) {
    return this.billingService.getInvoices(tenantId);
  }

  @Post('checkout/stripe')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start a Stripe subscription checkout — returns a client secret for Stripe Elements' })
  initiateStripeCheckout(@CurrentTenant() tenantId: string, @Body() dto: InitiateCheckoutDto) {
    return this.billingService.initiateStripeCheckout(tenantId, dto);
  }

  @Post('checkout/paystack')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start a Paystack subscription checkout — returns an access code for Paystack Inline' })
  initiatePaystackCheckout(@CurrentTenant() tenantId: string, @Body() dto: InitiateCheckoutDto) {
    return this.billingService.initiatePaystackCheckout(tenantId, dto);
  }

  @Post('promo')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Validate and preview a promo code discount' })
  applyPromoCode(@CurrentTenant() tenantId: string, @Body() dto: ApplyPromoCodeDto) {
    return this.billingService.applyPromoCode(tenantId, dto.code, dto.planSlug);
  }

  @Post('trial/:planSlug')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start a free trial for a plan' })
  startTrial(@CurrentTenant() tenantId: string, @Param('planSlug') planSlug: string) {
    return this.billingService['subscriptionService'].startTrial(tenantId, planSlug);
  }

  @Delete('cancel')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancel subscription at period end' })
  cancelSubscription(@CurrentTenant() tenantId: string, @Body() dto: CancelSubscriptionDto) {
    return this.billingService.cancelSubscription(tenantId, dto.immediately);
  }

  @Post('email')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update billing email' })
  updateBillingEmail(@CurrentTenant() tenantId: string, @Body() dto: UpdateBillingEmailDto) {
    return this.billingService.updateBillingEmail(tenantId, dto.billingEmail);
  }

  @Get('credits/packs')
  @ApiOperation({ summary: 'Get available AI credit packs' })
  getCreditPacks() {
    return this.billingService.getCreditPacks();
  }

  @Get('credits/balance')
  @ApiOperation({ summary: 'Get current AI credit balance' })
  getAiCredits(@CurrentTenant() tenantId: string) {
    return this.billingService.getAiCredits(tenantId);
  }

  @Post('credits/checkout/stripe')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Buy AI credits via Stripe — returns a client secret for Stripe Elements' })
  initiateStripeCreditCheckout(@CurrentTenant() tenantId: string, @Body() dto: InitiateCreditCheckoutDto) {
    return this.billingService.initiateStripeCreditCheckout(tenantId, dto);
  }

  @Post('credits/checkout/paystack')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Buy AI credits via Paystack — returns an access code for Paystack Inline' })
  initiatePaystackCreditCheckout(@CurrentTenant() tenantId: string, @Body() dto: InitiateCreditCheckoutDto) {
    return this.billingService.initiatePaystackCreditCheckout(tenantId, dto);
  }
}
