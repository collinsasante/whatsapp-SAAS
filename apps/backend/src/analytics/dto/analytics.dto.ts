import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

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
