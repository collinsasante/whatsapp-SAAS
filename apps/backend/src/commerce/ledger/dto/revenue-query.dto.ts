import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Period for the Revenue page. Presets resolve in the workspace timezone; custom needs both dates. */
export class RevenueRangeQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '30d', '90d', 'custom'])
  preset?: 'today' | '7d' | '30d' | '90d' | 'custom';

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}
