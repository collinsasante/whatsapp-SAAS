import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { StrictBoolean } from '../../common/validation/strict-boolean.decorator';
/**
 * Onboarding progress and business profile. Deliberately has no `plan`: a workspace's entitlements come from its subscription, and a
 * client must never be able to label itself with a plan. businessName/businessEmail are what the onboarding screen sends from the
 * WhatsApp profile lookup; they are accepted for compatibility and not stored here.
 */
export class UpdateOnboardingDto {
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) step?: number;
  @ApiProperty({ required: false }) @IsOptional() @StrictBoolean() completed?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) industry?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(50) teamSize?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2048) logoUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) businessCategory?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) businessDescription?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) businessAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2048) businessWebsite?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) businessName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(320) businessEmail?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) phoneNumberId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) wabaId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1024) accessToken?: string;
}
