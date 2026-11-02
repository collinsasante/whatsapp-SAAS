import type { Prisma } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Workspace settings a workspace admin may change. Each DTO lists exactly the fields its screen sends. Everything else on
 * TenantSettings is deliberately absent: the platform take rate, payment-verification switch, agent limit, AI trial approval,
 * Airtable credentials and tenantId are not editable from these routes (the global ValidationPipe rejects unknown fields).
 */
export class UpdateWelcomeDto {
  @IsOptional() @IsBoolean() welcomeEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) welcomeMessage?: string;
}

export class UpdateOffHoursDto {
  @IsOptional() @IsBoolean() offHoursEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) offHoursMessage?: string;
  @IsOptional() @IsObject() offHoursSchedule?: Prisma.InputJsonObject;
}

export class UpdateOptInOutDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) optOutKeywords?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) optInKeywords?: string[];
  @IsOptional() @IsString() @MaxLength(4096) optOutReply?: string;
  @IsOptional() @IsString() @MaxLength(4096) optInReply?: string;
}

export class UpdateWidgetDto {
  @IsOptional() @IsBoolean() widgetEnabled?: boolean;
  @IsOptional() @IsObject() widgetConfig?: Prisma.InputJsonObject;
}

export class UpdateAiSettingsDto {
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @IsOptional() @IsBoolean() aiAlwaysOn?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) aiPersonality?: string;
  @IsOptional() @IsIn(['SUGGESTION', 'AUTO_REPLY']) aiMode?: string;
  @IsOptional() @IsBoolean() aiPilotGroup?: boolean;
}
