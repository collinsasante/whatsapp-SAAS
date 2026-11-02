import { checkCustomerText, parseStructuredReply } from './model-output.util';
import { shouldEscalateOnConfidence } from '../pipeline/escalation-detector.util';

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
    ['JSON array', '[{"response":"hi"}]', 'malformed'],
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

describe('checkCustomerText: ordinary prose is not mistaken for a provider error', () => {
  it.each([
    'Sorry, that item is forbidden to ship by air.',
    'You are unauthorized to collect it, so please bring the buyer ID.',
    'Our rate limit for free delivery is one parcel per day.',
    'We do not allow a content filter on custom prints, but we can add a matte finish.',
    'Error-free packaging is our promise.',
  ])('passes "%s"', (text) => {
    expect(checkCustomerText(text)).toEqual({ safe: true });
  });

  it.each([
    'Unauthorized',
    '401 Unauthorized',
    'Forbidden.',
    '429 Too Many Requests',
    'Error: connect ETIMEDOUT 10.0.0.1:443',
    'You exceeded your current quota',
    'Rate limit exceeded',
    'rate_limit_exceeded',
    'The model gpt-x does not exist',
    '{"error":{"message":"bad","code":"insufficient_quota"}}',
  ])('rejects genuine provider error "%s"', (text) => {
    expect(checkCustomerText(text).safe).toBe(false);
  });
});

describe('parseStructuredReply: prose that quotes "response"', () => {
  it('keeps ordinary text that mentions "response"', () => {
    const text = 'We will send a "response" within 24 hours.';
    expect(parseStructuredReply(text)).toEqual({ ok: true, response: text, confidence: null, recovered: false });
  });
  it('keeps prose that contains JSON-like text after a sentence', () => {
    const r = parseStructuredReply('Use the word "response" : it is a keyword in our form.');
    expect(r.ok).toBe(true);
  });
  it('still parses a fenced JSON reply', () => {
    expect(parseStructuredReply('```json\n{"response":"Hi!","confidence":80}\n```')).toMatchObject({ ok: true, response: 'Hi!', confidence: 80 });
  });
  it('still rejects truncated structured output without exposing it', () => {
    const r = parseStructuredReply('{"response":"Hello! Our shea butter comes in two sizes, 250g for GH');
    expect(r).toEqual({ ok: false, reason: 'truncated' });
  });
  it('still rejects malformed structured output', () => {
    expect(parseStructuredReply('{"confidence": 80, oops')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('F1: structured reply objects after a sentence of preamble', () => {
  it('recovers the complete reply and drops the preamble and the JSON', () => {
    expect(parseStructuredReply('Sure! {"response":"Hi","confidence":85}')).toEqual({ ok: true, response: 'Hi', confidence: 85, recovered: false });
  });
  it('rejects a complete reply object followed by prose: the trailing text could change the intended answer', () => {
    expect(parseStructuredReply('Here you go: {"response":"Hi there","confidence":70} Hope that helps!')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseStructuredReply('{"response":"Hi"} trailing')).toEqual({ ok: false, reason: 'malformed' });
  });
  it('still recovers a reply object that only lacks its closing brace or has a cut-off confidence', () => {
    expect(parseStructuredReply('Sure! {"response":"Hi","confidence":8')).toMatchObject({ ok: true, response: 'Hi', recovered: true });
    expect(parseStructuredReply('{"response":"Hi",')).toMatchObject({ ok: true, response: 'Hi', recovered: true });
  });
  it('rejects a truncated object after a preamble without exposing it', () => {
    expect(parseStructuredReply('Sure! {"response":"Hello! Our shea butter comes in two sizes, 250g for GH')).toEqual({ ok: false, reason: 'truncated' });
  });
  it('rejects a preamble followed by an object that is not a reply', () => {
    expect(parseStructuredReply('Sure! {"confidence": 80, oops')).toEqual({ ok: false, reason: 'malformed' });
  });
  it('keeps ordinary prose that quotes "response" or mentions JSON-looking text without a reply object', () => {
    expect(parseStructuredReply('We will send a "response" within 24 hours.').ok).toBe(true);
    expect(parseStructuredReply('Our form has a "confidence" box: tick it if you are sure.').ok).toBe(true);
  });
  it('checkCustomerText (v2 tool-calling and Commerce replies) refuses a reply object anywhere in the text', () => {
    expect(checkCustomerText('Sure! {"response":"Hi"}')).toEqual({ safe: false, reason: 'malformed' });
    expect(checkCustomerText('Sure! {"response":"Hello… GH')).toEqual({ safe: false, reason: 'malformed' });
    expect(checkCustomerText('We will send a "response" within 24 hours.')).toEqual({ safe: true });
  });
});

describe('F2: error-looking words at the start of a normal apology', () => {
  it.each([
    'Exception: we can deliver on Sunday',
    'Error on our side, sorry! Your refund is on its way.',
    'Fatal mistake on our part, sorry',
    'Error: we charged you twice. A refund is on its way.',
    'Exception made for you: delivery is free today.',
    'Fatal error in our stock count, sorry. We will confirm availability shortly.',
  ])('passes "%s"', (text) => {
    expect(checkCustomerText(text)).toEqual({ safe: true });
  });
  it.each([
    'Error: connect ETIMEDOUT 10.0.0.1:443',
    'Error: Request failed with status code 429',
    'Error: 503 Service Unavailable',
    'Exception: socket hang up',
    'TypeError: Cannot read properties of undefined',
    'AxiosError: timeout of 30000ms exceeded',
    'FATAL ERROR: heap out of memory',
    'Fatal error: invalid_api_key',
    'Traceback (most recent call last):\n  File "x.py", line 1',
    '401 Unauthorized',
  ])('rejects technical error "%s"', (text) => {
    expect(checkCustomerText(text).safe).toBe(false);
  });
});

describe('F-A: generic JSON objects after a preamble never reach a customer', () => {
  it.each([
    'Sure {"error":{"message":"x"},"response":"leak"}',
    'Sure! {"error":{"message":"Rate limit reached"}}',
    'Here: {"status": "ok"}',
    'Result {"data":[1,2]}',
  ])('checkCustomerText rejects "%s"', (text) => {
    expect(checkCustomerText(text)).toEqual({ safe: false, reason: 'malformed' });
    expect(parseStructuredReply(text).ok).toBe(false);
  });
  it('keeps ordinary prose that mentions "response" or "confidence", or uses braces without a JSON key', () => {
    for (const text of ['Our response time is 24 hours.', 'We said "response" and "confidence" are required fields.', 'Use {name} as the placeholder.']) {
      expect(checkCustomerText(text)).toEqual({ safe: true });
    }
  });
});

describe('F-B: ambiguous or unsafe structured recovery', () => {
  it.each([
    ['nested in another object', 'Sure {"foo":{"response":"nested"}}'],
    ['inside an array after a preamble', 'Sure! [{"response":"hi"}]'],
    ['an example followed by the real answer', 'Example format: {"response":"your text here"} -- here is the real answer: we open at 8am.'],
    ['two reply objects', 'Sure! {"response":"first"} {"response":"second"}'],
    ['two reply objects, the second truncated', 'Sure! {"response":"first"} then {"response":"sec'],
    ['an object after an earlier brace', 'Use {name} then {"response":"Hi"}'],
  ])('refuses %s', (_label, text) => {
    expect(parseStructuredReply(text)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('still recovers a single reply object after ordinary preamble', () => {
    expect(parseStructuredReply('Sure! {"response":"We open at 8am.","confidence":90}')).toEqual({ ok: true, response: 'We open at 8am.', confidence: 90, recovered: false });
    expect(parseStructuredReply('Sure! {"confidence":90,"response":"Hi"}')).toMatchObject({ ok: true, response: 'Hi', confidence: 90 });
  });
  it('keeps rejecting arrays, and keeps accepting prose that quotes "response"', () => {
    expect(parseStructuredReply('[{"response":"hi"}]')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseStructuredReply('Please send a "response" within 24 hours.').ok).toBe(true);
  });
});

describe('F-C: generic technical failures', () => {
  it.each([
    'Error: Internal Server Error',
    'Error: Something went wrong. Please try again later.',
    'Exception: Service Unavailable',
    'HTTP 500 Internal Server Error',
    'HTTP/1.1 502 Bad Gateway',
    'The server returned: 429 Too Many Requests',
    'The API responded with 503 Service Unavailable',
    'Exception in thread "main" java.lang.NullPointerException',
    'java.lang.IllegalStateException: boom',
    '\tat com.example.Service.run(Service.java:42)',
  ])('rejects "%s"', (text) => {
    expect(checkCustomerText(text).safe).toBe(false);
  });
  it.each([
    'Our website showed "Internal Server Error" earlier, sorry about that. Please try your order again.',
    'Something went wrong with your delivery, sorry! We are fixing it now.',
    'Error: we shipped the wrong size. A replacement is on its way.',
    'The server at our shop returned your parcel to the depot, so we will redeliver on Monday.',
    'HTTP is not something we use, but you can order on WhatsApp.',
    'Exception made for you: delivery is free today.',
  ])('accepts the business reply "%s"', (text) => {
    expect(checkCustomerText(text)).toEqual({ safe: true });
  });
});

describe('confidence scale: a 0-1 score is read as a fraction, everything else keeps its 0-100 meaning', () => {
  const confidenceOf = (value: string) => {
    const parsed = parseStructuredReply(`{"response":"Hi","confidence":${value}}`);
    return parsed.ok ? parsed.confidence : 'refused';
  };

  it.each([
    ['0.92', 92], ['0.5', 50], ['0.05', 5], ['0.999', 100], ['0.004', 0],
  ])('reads the fraction %s as %i', (value, expected) => {
    expect(confidenceOf(value)).toBe(expected);
  });

  it.each([
    ['92', 92], ['85', 85], ['20', 20], ['100', 100], ['0', 0], ['1', 1], ['1.0', 1], ['1.5', 2], ['92.4', 92], ['92.6', 93], ['150', 100], ['-5', 0],
  ])('keeps the established 0-100 reading of %s as %i', (value, expected) => {
    expect(confidenceOf(value)).toBe(expected);
  });

  it('still reads a numeric string, null or a boolean as no confidence', () => {
    expect(confidenceOf('"0.92"')).toBeNull();
    expect(confidenceOf('"92"')).toBeNull();
    expect(confidenceOf('null')).toBeNull();
    expect(confidenceOf('true')).toBeNull();
  });

  it('no longer hands a confident 0-1 answer to a human, and still hands over a genuinely low score', () => {
    const handoff = (value: string) => shouldEscalateOnConfidence(confidenceOf(value) as number | null);
    expect(handoff('0.92')).toBe(false);
    expect(handoff('0.15')).toBe(true); // 15 out of 100: a real knowledge gap
    expect(handoff('15')).toBe(true);
    expect(handoff('20')).toBe(true);
    expect(handoff('21')).toBe(false);
  });

  it('reads a fraction in the broken-JSON recovery path too', () => {
    expect(parseStructuredReply('{"response":"Hi","confidence":0.92')).toMatchObject({ ok: true, response: 'Hi', confidence: 92, recovered: true });
    expect(parseStructuredReply('Sure! {"response":"Hi","confidence":0.5')).toMatchObject({ ok: true, response: 'Hi', confidence: 50, recovered: true });
  });
});

// Investigated for the v2 tool-calling path, where the provider cannot be asked for JSON mode and a model sometimes adds a note
// after the object. Not supported, on purpose: text after a complete reply object cannot be told apart from a correction of it.
describe('text after a complete reply object stays refused', () => {
  it.each([
    ['a harmless note', '{"response":"We open at nine.","confidence":90}\n\nNote: I used the opening-hours article.'],
    ['a correction that reverses the answer', '{"response":"Yes, we deliver on Sundays.","confidence":90}\n\nActually, we do not deliver on Sundays.'],
    ['a second answer in prose', '{"response":"Yes.","confidence":90} The real answer is no.'],
    ['a second reply object', '{"response":"Yes.","confidence":90} {"response":"No.","confidence":90}'],
    ['a stray closing brace', '{"response":"Yes.","confidence":90}}'],
  ])('refuses %s as malformed', (_name, raw) => {
    expect(parseStructuredReply(raw)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a harmless note and a correction have the same shape, so no rule over the text can accept one and refuse the other', () => {
    const note = parseStructuredReply('{"response":"We open at nine.","confidence":90}\n\nNote: this came from article three.');
    const correction = parseStructuredReply('{"response":"We open at nine.","confidence":90}\n\nCorrection: we open at ten.');
    expect(note).toEqual(correction);
  });
});
