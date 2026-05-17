import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { BillingCycle, PaymentGateway } from '@whatsapp-platform/shared-types';

export class InitiateCheckoutDto {
  @IsString()
  planSlug: string;

  @IsEnum(BillingCycle)
  cycle: BillingCycle;

  @IsEnum(PaymentGateway)
  gateway: PaymentGateway;

  @IsEmail()
  @IsOptional()
  billingEmail?: string;

  @IsString()
  @IsOptional()
  promoCode?: string;
}

export class UpdateBillingEmailDto {
  @IsEmail()
  billingEmail: string;
}

export class CancelSubscriptionDto {
  @IsOptional()
  immediately?: boolean;
}

export class ApplyPromoCodeDto {
  @IsString()
  code: string;

  @IsString()
  planSlug: string;
}

export class VerifyPaymentDto {
  @IsEnum(PaymentGateway)
  gateway: PaymentGateway;

  @IsString()
  reference: string;

  @IsUUID()
  @IsOptional()
  invoiceId?: string;
}
