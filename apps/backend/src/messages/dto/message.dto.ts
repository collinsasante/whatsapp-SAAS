import { IsString, IsEnum, IsOptional, IsObject, IsNumber, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '@whatsapp-platform/shared-types';

export class SendMessageDto {
  @ApiProperty({ required: false, description: 'Client-generated id; re-sending the same id returns the original result instead of messaging the customer twice.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientMessageId?: string;

  @ApiProperty({ example: 'Hello, how can I help?' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false, description: 'Set when the text is an unedited saved reply, so it is not mistaken for the agent\'s own writing.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cannedResponseId?: string;

  @ApiProperty({ required: false, description: 'Set when the text was written by Verz AI (a suggestion the agent sent or started from).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiSuggestionLogId?: string;

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
