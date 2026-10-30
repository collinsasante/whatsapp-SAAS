import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Range for every owner-dashboard widget. Presets resolve in the workspace timezone; custom needs both dates. */
export class DashboardRangeQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '30d', 'custom'])
  preset?: 'today' | '7d' | '30d' | 'custom';

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}

export class WhatsAppStatusQueryDto {
  /** `true` asks for a fresh check with Meta instead of the answer cached for the last minute. */
  @IsOptional()
  @IsIn(['true', 'false'])
  refresh?: 'true' | 'false';
}
