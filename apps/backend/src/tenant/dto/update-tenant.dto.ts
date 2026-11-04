import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { StrictBoolean } from '../../common/validation/strict-boolean.decorator';
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
  @StrictBoolean()
  autoReply?: boolean;

  @ApiProperty({ required: false, description: "Transcribe customers' voice notes (sent to a third-party provider; uses AI credits)." })
  @IsOptional()
  @StrictBoolean()
  voiceTranscriptionEnabled?: boolean;

  @ApiProperty({ required: false, description: "Describe customers' images (sent to a third-party provider; uses AI credits)." })
  @IsOptional()
  @StrictBoolean()
  imageUnderstandingEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  autoReplyMessage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @StrictBoolean()
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
