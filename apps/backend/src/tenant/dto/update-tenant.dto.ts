import { IsString, IsOptional, IsBoolean, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  wabaId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accessToken?: string;
}

export class UpdateTenantSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  businessPhone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  businessDescription?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  businessWebsite?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  autoReply?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  autoReplyMessage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  airtableEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  airtableApiKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  airtableBaseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  airtableTableName?: string;
}
