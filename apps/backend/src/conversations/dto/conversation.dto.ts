import { IsString, IsOptional, IsEnum, IsArray, IsDateString, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ConversationStatus } from '@whatsapp-platform/shared-types';

export class CreateConversationDto {
  @ApiProperty()
  @IsString()
  contactId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class UpdateConversationDto {
  @ApiProperty({ required: false, enum: ConversationStatus })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  snoozedUntil?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  priority?: number;
}

export class RequestSupportDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class TransferConversationDto {
  @ApiProperty()
  @IsString()
  toAgentId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateNoteDto {
  @ApiProperty()
  @IsString()
  content: string;
}
