import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsNumber, IsBoolean, IsArray, IsIn, IsInt, Matches, Max, Min } from 'class-validator';
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

export class FunnelQueryDto {
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' }) to?: string;
}

export class UsageQueryDto {
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' }) to?: string;
}

export const TENANT_TABLE_FILTERS = ['churn_risk', 'trial_ending_7d', 'high_value', 'signed_up_this_month', 'past_due'] as const;
export type TenantTableFilter = (typeof TENANT_TABLE_FILTERS)[number];

export const TENANT_TABLE_SORTS = ['name', 'createdAt', 'mrr', 'healthScore'] as const;
export type TenantTableSort = (typeof TENANT_TABLE_SORTS)[number];

export const TENANT_STATUS_FILTERS = ['active', 'trial', 'past_due', 'suspended', 'churned', 'no_subscription'] as const;

export class TenantsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  /** Plan slug. */
  @IsOptional() @IsString() @MaxLength(60) plan?: string;
  @IsOptional() @IsIn(TENANT_STATUS_FILTERS) status?: (typeof TENANT_STATUS_FILTERS)[number];
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'createdFrom must be a YYYY-MM-DD date' }) createdFrom?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'createdTo must be a YYYY-MM-DD date' }) createdTo?: string;
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

/** Why a privileged action is being taken. Stored in the audit trail, so it must say something. */
export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class OptionalReasonDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ForcePlanDto {
  @IsString() @MinLength(1) @MaxLength(60) planSlug: string;
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

/** 72 is bcrypt's input limit: a longer password would be silently truncated, so it is refused instead. */
export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(12) @MaxLength(72) password: string;
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

// ── Verz AI Credits admin config ────────────────────────────────────────────

export class CreateAiPricingConfigDto {
  @IsString()  provider: string;
  @IsString()  modelKey: string;
  @IsNumber()  inputCostPerMillionUsd: number;
  @IsNumber()  outputCostPerMillionUsd: number;
  @IsNumber()  creditsPerUsd: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateAiPricingConfigDto {
  @IsOptional() @IsNumber()  inputCostPerMillionUsd?: number;
  @IsOptional() @IsNumber()  outputCostPerMillionUsd?: number;
  @IsOptional() @IsNumber()  creditsPerUsd?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAiCreditPackageDto {
  @IsString()  slug: string;
  @IsString()  name: string;
  @IsInt() @Min(1) credits: number;
  @IsOptional() @IsInt() @Min(0) bonusCredits?: number;
  @IsOptional() @IsNumber() priceGhs?: number;
  @IsOptional() @IsNumber() priceUsd?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() displayOrder?: number;
}

export class UpdateAiCreditPackageDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsInt() @Min(1) credits?: number;
  @IsOptional() @IsInt() @Min(0) bonusCredits?: number;
  @IsOptional() @IsNumber() priceGhs?: number;
  @IsOptional() @IsNumber() priceUsd?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() displayOrder?: number;
}

export class UpdateCommerceFeeDefaultDto {
  @IsNumber() @Min(0) @Max(100) defaultCommerceFeePct: number;
}

/** Upper bound on a single manual grant: large enough for any real top-up, small enough that a typo cannot add millions. */
export const MAX_CREDIT_GRANT = 1_000_000;

export class GrantCreditsDto {
  @IsInt() @Min(1) @Max(MAX_CREDIT_GRANT) credits: number;
  @IsString() @MinLength(3) @MaxLength(200) description: string;
  @IsOptional() @IsIn(['BONUS', 'ADJUSTMENT']) type?: 'BONUS' | 'ADJUSTMENT';
}

// ── Admin platform: invite & RBAC ───────────────────────────────────────────

export class InviteAdminDto {
  @IsEmail() email: string;
  @IsString() name: string;
  @IsIn(['SUPER_ADMIN', 'SUPPORT', 'VIEWER']) role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER';
}

export class UpdateAdminRoleDto {
  @IsIn(['SUPER_ADMIN', 'SUPPORT', 'VIEWER']) role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER';
}

// ── Monitoring: error logs & webhook events ─────────────────────────────────

export class ErrorLogsQueryDto {
  @IsOptional() @IsIn(['OPEN', 'RESOLVED', 'IGNORED']) status?: string;
  @IsOptional() @IsIn(['WARN', 'ERROR', 'CRITICAL']) severity?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() @MaxLength(60) service?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class UpdateErrorLogStatusDto {
  @IsIn(['OPEN', 'RESOLVED', 'IGNORED']) status: 'OPEN' | 'RESOLVED' | 'IGNORED';
}

export class WebhookEventsQueryDto {
  @IsOptional() @IsIn(['WHATSAPP', 'STRIPE_BILLING', 'PAYSTACK_BILLING', 'PAYSTACK_COMMERCE']) source?: string;
  @IsOptional() @IsIn(['RECEIVED', 'PROCESSED', 'FAILED']) status?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

// ── Analytics: AI / Commerce / Messaging / Payments / Audit ────────────────

export class AiCreditWalletsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class AiCreditTransactionsQueryDto {
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsIn(['PURCHASE', 'BONUS', 'AI_USAGE', 'REFUND', 'ADJUSTMENT']) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export const ORDER_STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'PENDING_PAYMENT', 'PAID', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const;

export class OrdersQueryDto {
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsIn(ORDER_STATUSES) status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class PaymentsQueryDto {
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsIn(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'DISPUTED']) status?: string;
  @IsOptional() @IsIn(['STRIPE', 'PAYSTACK']) gateway?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class AuditLogsQueryDto {
  @IsOptional() @IsString() adminId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() resourceType?: string;
  @IsOptional() @IsString() @MaxLength(100) resourceId?: string;
  /** Matches the admin's name or email. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' }) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class UsersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(60) tenantId?: string;
  @IsOptional() @IsIn(['ADMIN', 'AGENT', 'VIEWER', 'SUPER_ADMIN']) role?: string;
  @IsOptional() @IsIn(['active', 'suspended']) status?: 'active' | 'suspended';
  @IsOptional() @IsIn(['createdAt', 'lastLoginAt', 'name']) sort?: 'createdAt' | 'lastLoginAt' | 'name';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class SearchQueryDto {
  @IsString() q: string;
}

// ── Feature flags (admin CRUD -- FeatureFlagsService methods already exist, wiring routes) ──

export class CreateFeatureFlagDto {
  @IsString() key: string;
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() rolloutType?: string;
  @IsOptional() @IsNumber() rolloutPct?: number;
  @IsOptional() @IsArray() betaTenants?: string[];
  @IsOptional() @IsString() environment?: string;
  @IsOptional() @IsString() category?: string;
}

export class UpdateFeatureFlagDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() rolloutType?: string;
  @IsOptional() @IsNumber() rolloutPct?: number;
  @IsOptional() @IsArray() betaTenants?: string[];
  @IsOptional() @IsString() environment?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() killSwitch?: boolean;
}

export class SetFlagRolloutDto {
  @IsBoolean() enabled: boolean;
}
