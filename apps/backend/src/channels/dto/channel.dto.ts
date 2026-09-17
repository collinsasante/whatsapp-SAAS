import { IsEnum, IsString, IsOptional, IsBoolean, IsObject, IsArray, ArrayMinSize } from 'class-validator';
import { ChannelType } from '@whatsapp-platform/shared-types';

export class CreateChannelDto {
  @IsEnum(ChannelType)
  type: ChannelType;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SelectFacebookPagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  pageIds: string[];
}
