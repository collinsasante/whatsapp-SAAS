import { IsEmail, IsString, MinLength, IsOptional, IsNumber, IsBoolean, IsArray, IsIn, IsInt, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class OverviewQueryDto {
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' }) to?: string;
}

export class RevenueQueryDto {
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' }) to?: string;
}

export const TENANT_TABLE_FILTERS = ['churn_risk', 'trial_ending_7d', 'high_value', 'signed_up_this_month', 'past_due'] as const;
export type TenantTableFilter = (typeof TENANT_TABLE_FILTERS)[number];

export const TENANT_TABLE_SORTS = ['name', 'createdAt', 'mrr', 'healthScore'] as const;
export type TenantTableSort = (typeof TENANT_TABLE_SORTS)[number];

export class TenantsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(TENANT_TABLE_FILTERS) filter?: TenantTableFilter;
  @IsOptional() @IsIn(TENANT_TABLE_SORTS) sort?: TenantTableSort;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class AdminSetupDto {
  @IsString()
  setupSecret: string;

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class AdminLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class CreatePlanDto {
  @IsString()  slug: string;
  @IsString()  name: string;
  @IsOptional() @IsString()  description?: string;
  @IsNumber()  monthlyPrice: number;
  @IsNumber()  yearlyPrice: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsNumber()  trialDays?: number;
  @IsOptional() @IsNumber()  limMaxAgents?: number;
  @IsOptional() @IsNumber()  limMaxChannels?: number;
  @IsOptional() @IsNumber()  limMaxContacts?: number;
  @IsOptional() @IsNumber()  limMessagesPerMonth?: number;
  @IsOptional() @IsNumber()  limAiCreditsPerMonth?: number;
  @IsOptional() @IsNumber()  limMaxChannels2?: number;
  @IsOptional() @IsNumber()  limMaxCampaigns?: number;
  @IsOptional() @IsNumber()  limStorageGb?: number;
  @IsOptional() @IsNumber()  limMaxTemplates?: number;
  @IsOptional() @IsArray()   features?: string[];
  @IsOptional() @IsNumber()  sortOrder?: number;
}

export class UpdateWorkspaceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() billingEmail?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsNumber()  monthlyPrice?: number;
  @IsOptional() @IsNumber()  yearlyPrice?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsNumber()  limMaxAgents?: number;
  @IsOptional() @IsNumber()  limMaxContacts?: number;
  @IsOptional() @IsNumber()  limMessagesPerMonth?: number;
  @IsOptional() @IsNumber()  limAiCreditsPerMonth?: number;
  @IsOptional() @IsNumber()  limMaxChannels?: number;
  @IsOptional() @IsNumber()  limMaxCampaigns?: number;
  @IsOptional() @IsNumber()  limStorageGb?: number;
  @IsOptional() @IsNumber()  limMaxTemplates?: number;
  @IsOptional() @IsArray()   features?: string[];
}
