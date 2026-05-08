import { IsString, IsEnum, IsOptional, IsObject, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '@whatsapp-platform/shared-types';

export class SendMessageDto {
  @ApiProperty({ example: 'Hello, how can I help?' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ enum: MessageType, default: MessageType.TEXT })
  @IsEnum(MessageType)
  type: MessageType = MessageType.TEXT;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mediaCaption?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  templateVariables?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  locationLatitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  locationLongitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  locationName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  locationAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contactPhone?: string;
}
