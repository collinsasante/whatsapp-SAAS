import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { MAX_REPLY_DEADLINE_MINUTES, MIN_REPLY_DEADLINE_MINUTES } from '../../../conversations/reply-deadline.util';

export class UpdateReplyDeadlineDto {
  /** Whole minutes between 1 and 1440, or null to turn the deadline off. */
  @ValidateIf((o: UpdateReplyDeadlineDto) => o.minutes !== null)
  @IsInt()
  @Min(MIN_REPLY_DEADLINE_MINUTES)
  @Max(MAX_REPLY_DEADLINE_MINUTES)
  minutes!: number | null;
}
