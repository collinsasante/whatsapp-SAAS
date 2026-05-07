import { IsString, IsOptional, IsEnum, IsArray, IsDateString } from 'class-validator';
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
}

export class CreateNoteDto {
  @ApiProperty()
  @IsString()
  content: string;
}
