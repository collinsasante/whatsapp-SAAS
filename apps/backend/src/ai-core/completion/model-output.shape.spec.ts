import { describeReplyShape, parseStructuredReply } from './model-output.util';

describe('describeReplyShape', () => {
  it('says a blank answer is blank, with its raw length', () => {
    expect(describeReplyShape('     ')).toBe('chars=5 blank');
    expect(describeReplyShape(null)).toBe('chars=0 blank');
  });

  it('describes a clean reply object', () => {
    expect(describeReplyShape('{"response":"Hello there","confidence":90}')).toBe(
      'chars=42 trimmed=42 first=brace json_parses=true reply_objects=1 raw_line_break_in_reply=false parser=ok',
    );
  });

  it('describes a fenced reply object', () => {
    const shape = describeReplyShape('```json\n{"response":"Hello","confidence":90}\n```');
    expect(shape).toContain('first=fence');
    expect(shape).toContain('json_parses=true');
    expect(shape).toContain('parser=ok');
  });

  it('describes plain prose', () => {
    const shape = describeReplyShape('Yes, we deliver to Kumasi.');
    expect(shape).toContain('first=letter');
    expect(shape).toContain('json_parses=false');
    expect(shape).toContain('reply_objects=0');
    expect(shape).toContain('parser=ok');
  });

  it('flags a line break inside the reply string (invalid JSON that the parser can still recover)', () => {
    const shape = describeReplyShape('{"response":"Line one.\nLine two.","confidence":80}');
    expect(shape).toContain('json_parses=false');
    expect(shape).toContain('raw_line_break_in_reply=true');
    expect(shape).toContain('parser=recovered');
  });

  it('counts several reply objects and reports the parser refusing them', () => {
    const shape = describeReplyShape('{"response":"a","confidence":1} {"response":"b","confidence":2}');
    expect(shape).toContain('reply_objects=2');
    expect(shape).toContain('parser=malformed');
  });

  it('never contains the text it describes', () => {
    const shape = describeReplyShape('{"response":"SECRET-WORDS-123","confidence":90}');
    expect(shape).not.toContain('SECRET');
    expect(shape).not.toContain('123');
  });
});

describe('parseStructuredReply -- a line break inside the reply string', () => {
  it('recovers the reply with its line break', () => {
    const parsed = parseStructuredReply('{"response":"Yes, we deliver.\nIt takes one to two days.","confidence":85}');
    expect(parsed).toEqual({ ok: true, response: 'Yes, we deliver.\nIt takes one to two days.', confidence: 85, recovered: true });
  });

  it('still refuses a reply cut off before its closing quote', () => {
    expect(parseStructuredReply('{"response":"Yes, we deliver.\nIt takes')).toEqual({ ok: false, reason: 'truncated' });
  });
});
