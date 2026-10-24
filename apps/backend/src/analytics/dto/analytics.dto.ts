import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}

export class ConversationsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(['day', 'hour'])
  granularity?: 'day' | 'hour';
}

export class CampaignsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class IntelligenceQueryDto extends DateRangeQueryDto {
  /** Relative range, resolved in the workspace timezone. When omitted, `from` and `to` are used. */
  @IsOptional()
  @IsIn(['today', '7d', '30d', '90d', 'custom'])
  preset?: 'today' | '7d' | '30d' | '90d' | 'custom';

  @IsOptional()
  @IsIn(['ALL', 'WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM'])
  channel?: 'ALL' | 'WHATSAPP' | 'FACEBOOK_MESSENGER' | 'INSTAGRAM';
}
