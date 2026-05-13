import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallDirection, CallStatus } from '@whatsapp-platform/shared-types';

export class CreateCallDto {
  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiProperty({ enum: CallDirection }) @IsEnum(CallDirection) direction: CallDirection;
  @ApiProperty({ enum: CallStatus }) @IsEnum(CallStatus) status: CallStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endedAt?: string;
}

export class UpdateCallDto {
  @ApiPropertyOptional({ enum: CallStatus }) @IsOptional() @IsEnum(CallStatus) status?: CallStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() answeredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() recordingUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endReason?: string;
}

export class CreateCallNoteDto {
  @ApiProperty() @IsString() content: string;
}

export class ListCallsDto {
  @ApiPropertyOptional() @IsOptional() @IsEnum(CallDirection) direction?: CallDirection;
  @ApiPropertyOptional() @IsOptional() @IsEnum(CallStatus) status?: CallStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() isArchived?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) limit?: number;
}

export class TransferCallDto {
  @ApiProperty() @IsString() toUserId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() transferType?: 'WARM' | 'BLIND';
}

export class MuteCallDto {
  @ApiProperty() @IsBoolean() muted: boolean;
}

export class HoldCallDto {
  @ApiProperty() @IsBoolean() held: boolean;
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}
