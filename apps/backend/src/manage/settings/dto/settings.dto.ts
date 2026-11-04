import type { Prisma } from '@prisma/client';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { StrictBoolean } from '../../../common/validation/strict-boolean.decorator';
/**
 * Workspace settings a workspace admin may change. Each DTO lists exactly the fields its screen sends. Everything else on
 * TenantSettings is deliberately absent: the platform take rate, payment-verification switch, agent limit, AI trial approval,
 * Airtable credentials and tenantId are not editable from these routes (the global ValidationPipe rejects unknown fields).
 */
export class UpdateWelcomeDto {
  @IsOptional() @StrictBoolean() welcomeEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) welcomeMessage?: string;
}

export class UpdateOffHoursDto {
  @IsOptional() @StrictBoolean() offHoursEnabled?: boolean;
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
  @IsOptional() @StrictBoolean() widgetEnabled?: boolean;
  @IsOptional() @IsObject() widgetConfig?: Prisma.InputJsonObject;
}

export class UpdateAiSettingsDto {
  @IsOptional() @StrictBoolean() aiEnabled?: boolean;
  @IsOptional() @StrictBoolean() aiAlwaysOn?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) aiPersonality?: string;
  @IsOptional() @IsIn(['SUGGESTION', 'AUTO_REPLY']) aiMode?: string;
  @IsOptional() @StrictBoolean() aiPilotGroup?: boolean;
}
