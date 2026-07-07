import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { BillingCycle } from '@whatsapp-platform/shared-types';

export class InitiateCheckoutDto {
  @IsString()
  planSlug: string;

  @IsEnum(BillingCycle)
  cycle: BillingCycle;

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

export class InitiateCreditCheckoutDto {
  @IsString()
  packSlug: string;

  @IsEmail()
  @IsOptional()
  billingEmail?: string;
}
