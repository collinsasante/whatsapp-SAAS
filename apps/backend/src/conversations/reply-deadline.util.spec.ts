import { DEFAULT_REPLY_DEADLINE_MINUTES, effectiveReplyDeadlineMinutes, replyDeadlineAt } from './reply-deadline.util';

describe('reply deadline', () => {
  it('uses the default for a workspace with no settings row', () => {
    expect(effectiveReplyDeadlineMinutes(null)).toBe(DEFAULT_REPLY_DEADLINE_MINUTES);
    expect(effectiveReplyDeadlineMinutes(undefined)).toBe(15);
  });

  it('respects a stored value and a stored null (deadline off)', () => {
    expect(effectiveReplyDeadlineMinutes({ replyDeadlineMinutes: 45 })).toBe(45);
    expect(effectiveReplyDeadlineMinutes({ replyDeadlineMinutes: null })).toBeNull();
  });

  it('computes the overdue moment, or null when there is no deadline', () => {
    const from = new Date('2026-03-10T10:00:00Z');
    expect(replyDeadlineAt(from, 30)?.toISOString()).toBe('2026-03-10T10:30:00.000Z');
    expect(replyDeadlineAt(from, null)).toBeNull();
  });
});
