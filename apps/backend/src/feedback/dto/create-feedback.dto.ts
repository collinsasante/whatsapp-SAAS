import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum FeedbackType {
  BUG = 'BUG',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  GENERAL = 'GENERAL',
  BILLING = 'BILLING',
}

export class CreateFeedbackDto {
  @IsEnum(FeedbackType)
  type: FeedbackType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  page?: string;
}
