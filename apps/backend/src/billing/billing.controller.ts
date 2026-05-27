import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ApplyPromoCodeDto, CancelSubscriptionDto, InitiateCheckoutDto, UpdateBillingEmailDto } from './dto/billing.dto';

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

  @Post('checkout')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Initiate an offline payment request — returns reference and payment details' })
  initiateCheckout(@CurrentTenant() tenantId: string, @Body() dto: InitiateCheckoutDto) {
    return this.billingService.initiateCheckout(tenantId, dto);
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

  @Post('payment-confirmed')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Notify support that a business has confirmed payment intent' })
  notifyPaymentConfirmed(@CurrentTenant() tenantId: string, @Body() dto: { reference: string }) {
    return this.billingService.notifyPaymentConfirmed(tenantId, dto.reference);
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

  @Post('credits/initialize')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Request AI credits — returns reference and payment details' })
  initiateCreditPurchase(
    @CurrentTenant() tenantId: string,
    @Body() body: { packSlug: string },
  ) {
    return this.billingService.initiateCreditPurchase(tenantId, body.packSlug);
  }

  // Admin-only activation endpoints — called via link in notification email
  @Get('admin/activate')
  adminActivateSubscription(
    @Query('ref') ref: string,
    @Query('secret') secret: string,
  ) {
    return this.billingService.adminActivateSubscription(secret, ref);
  }

  @Get('admin/activate-credits')
  adminActivateCredits(
    @Query('ref') ref: string,
    @Query('secret') secret: string,
  ) {
    return this.billingService.adminActivateCredits(secret, ref);
  }
}
