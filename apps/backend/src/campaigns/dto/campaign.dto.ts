import { IsString, IsOptional, IsArray, IsObject, IsDateString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  templateId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  templateVariables?: Record<string, string>;

  @ApiProperty({ required: false, type: [String], description: 'Contact IDs or label filters' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiProperty({ required: false, description: 'Target a saved segment by ID' })
  @IsOptional()
  @IsString()
  segmentId?: string;

  @ApiProperty({ required: false, type: [String], description: 'Raw phone numbers (resolved to contacts on create)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];

  @ApiProperty({ required: false, description: 'ISO datetime string for scheduled send' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({ required: false, description: 'API-only campaign — no recipients; messages are sent individually via the send API' })
  @IsOptional()
  @IsBoolean()
  apiOnly?: boolean;

  @ApiProperty({ required: false, description: 'Destination URL to track clicks for this campaign' })
  @IsOptional()
  @IsString()
  trackingUrl?: string;
}

export class UpdateCampaignDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  templateVariables?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
