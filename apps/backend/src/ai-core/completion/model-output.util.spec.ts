import { checkCustomerText, parseStructuredReply } from './model-output.util';

describe('parseStructuredReply', () => {
  it('reads a well-formed reply and clamps confidence', () => {
    expect(parseStructuredReply('{"response":"Hello!","confidence":140}')).toEqual({ ok: true, response: 'Hello!', confidence: 100, recovered: false });
    expect(parseStructuredReply('{"response":"Hi","confidence":"high"}')).toMatchObject({ ok: true, confidence: null });
  });

  it('reads JSON inside a code fence', () => {
    expect(parseStructuredReply('```json\n{"response":"Hi","confidence":80}\n```')).toMatchObject({ ok: true, response: 'Hi', confidence: 80 });
  });

  it('recovers a complete reply whose JSON is missing only the closing brace', () => {
    expect(parseStructuredReply('{"response":"250g is GHS 45.","confidence":88')).toEqual({ ok: true, response: '250g is GHS 45.', confidence: 88, recovered: true });
  });

  it('unescapes quotes and newlines in a recovered reply', () => {
    expect(parseStructuredReply('{"response":"Say \\"hello\\"\\nthen wait","confidence":70')).toMatchObject({ ok: true, response: 'Say "hello"\nthen wait' });
  });

  it('rejects a reply cut off inside the response string', () => {
    expect(parseStructuredReply('{"response":"Hello! Our shea butter comes in two sizes, 250g for GHS 45 and 500g for GH')).toEqual({ ok: false, reason: 'truncated' });
  });

  it.each([
    ['empty', '', 'empty'],
    ['whitespace', '   \n ', 'empty'],
    ['provider error body', '{"error":{"message":"Rate limit reached"}}', 'internal_error'],
    ['broken JSON with no reply', '{"conf', 'malformed'],
    ['JSON array', '[{"response":"hi"}]', 'internal_error'],
    ['HTML page', '<html><body>502 Bad Gateway</body></html>', 'internal_error'],
    ['stack trace', 'TypeError: x is undefined\n    at run (/app/dist/ai.js:10:5)', 'internal_error'],
    ['error text', 'Error: insufficient_quota', 'internal_error'],
    ['bare null', 'null', 'internal_error'],
    ['object placeholder', '[object Object]', 'internal_error'],
    ['too long', JSON.stringify({ response: 'a '.repeat(2300) }), 'too_long'],
  ])('never accepts %s', (_name, raw, reason) => {
    expect(parseStructuredReply(raw)).toEqual({ ok: false, reason });
  });

  it('accepts clean plain prose from a model that ignored the JSON format', () => {
    expect(parseStructuredReply('We open at 8am.')).toEqual({ ok: true, response: 'We open at 8am.', confidence: null, recovered: false });
  });

  it('does not reject an ordinary reply that merely mentions a limit or an error in words', () => {
    expect(parseStructuredReply('{"response":"Sorry, there was an error on the delivery note. We have fixed it.","confidence":90}')).toMatchObject({ ok: true });
    expect(parseStructuredReply('{"response":"Orders over the limit of 50 units get wholesale prices.","confidence":90}')).toMatchObject({ ok: true });
  });

  it('never throws, whatever it is given', () => {
    for (const raw of [undefined, null, '\u0000', '{', '}', '"', '{"response":', '{"response":1}', '{"response":"x"} trailing']) {
      expect(() => parseStructuredReply(raw as never)).not.toThrow();
    }
  });
});

describe('checkCustomerText', () => {
  it('passes ordinary customer-facing text', () => {
    expect(checkCustomerText('Yes, we deliver to Kumasi for GHS 35.')).toEqual({ safe: true });
  });
  it.each(['', '   ', '{"response":"hi"}', 'Internal Server Error', 'invalid_api_key', 'Bearer abcdefghijklmnopqrstuvwxyz'])('rejects "%s"', (text) => {
    expect(checkCustomerText(text).safe).toBe(false);
  });
});
