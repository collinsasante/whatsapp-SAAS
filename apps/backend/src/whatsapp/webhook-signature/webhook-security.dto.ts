import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { StrictBoolean } from '../../common/validation/strict-boolean.decorator';

export const META_APP_ID = /^\d{5,25}$/;
export const WABA_ID = /^\d{5,25}$/;

export class UpsertMetaAppDto {
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
  /** The Meta app secret. Optional on update. Stored encrypted; never returned. */
  @IsOptional() @IsString() @MinLength(16) @MaxLength(128) @Matches(/^\S+$/, { message: 'secret must not contain whitespace' }) secret?: string;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}

export class MapWabaDto {
  @IsString() @MinLength(1) @MaxLength(64) tenantId!: string;
  @IsString() @Matches(WABA_ID, { message: 'wabaId must be the numeric WhatsApp Business Account id' }) wabaId!: string;
}

export class SummaryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) minValid?: number;
}

export class DiscoverDto {
  @IsOptional() @IsString() @MaxLength(64) tenantId?: string;
  /** false (default) only reports what would be mapped; true creates mappings for apps that are already registered. */
  @IsOptional() @StrictBoolean() apply?: boolean;
}
