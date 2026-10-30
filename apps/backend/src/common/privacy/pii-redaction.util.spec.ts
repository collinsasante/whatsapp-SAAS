import { CUT_MARKER, MAX_REDACT_INPUT, mergeCounts, redactText, REDACTION_VERSION } from './pii-redaction.util';

const r = (s: string, names?: string[]) => redactText(s, { knownNames: names });

describe('redactText: personal data and secrets are replaced by typed placeholders', () => {
  it.each([
    ['an email', 'write to ama.mensah+shop@example.co.uk please', 'write to [EMAIL] please', 'EMAIL'],
    ['an email at the end of a sentence', 'my mail is kofi@mail.com.', 'my mail is [EMAIL].', 'EMAIL'],
    ['a Ghana mobile number', 'call 0241234567 now', 'call [PHONE] now', 'PHONE'],
    ['an international number', 'WhatsApp +233 24 123 4567 for help', 'WhatsApp [PHONE] for help', 'PHONE'],
    ['a US-style number', 'try +1 (415) 555-2671', 'try [PHONE]', 'PHONE'],
    ['a card number that passes the Luhn check', 'my card is 4111 1111 1111 1111 thanks', 'my card is [CARD] thanks', 'CARD'],
    ['a card number written with dashes', 'card 5500-0000-0000-0004', 'card [CARD]', 'CARD'],
    ['a Ghana Card id', 'ID GHA-123456789-0 attached', 'ID [ID] attached', 'ID'],
    ['a payment link', 'pay here https://checkout.paystack.com/abc123xyz?token=s3cr3t done', 'pay here [URL] done', 'URL'],
    ['a www link', 'see www.example.com/page now', 'see [URL] now', 'URL'],
    ['a JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop end', 'token [TOKEN] end', 'TOKEN'],
    ['a bearer header', 'Authorization: Bearer abcdef0123456789abcdef0123 ok', 'Authorization: [TOKEN] ok', 'TOKEN'],
    ['a secret key', 'key sk_live_abcdef1234567890 oops', 'key [TOKEN] oops', 'TOKEN'],
    ['an OpenAI-style key', 'use sk-abcdefghijklmnop1234 here', 'use [TOKEN] here', 'TOKEN'],
    ['a long hex string', 'hash 0123456789abcdef0123456789abcdef done', 'hash [TOKEN] done', 'TOKEN'],
    ['a long mixed token', 'ref aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3f ok', 'ref [TOKEN] ok', 'TOKEN'],
    ['a long account-style number', 'account 12345678 please', 'account [NUMBER] please', 'NUMBER'],
  ])('%s', (_label, input, expected, kind) => {
    const out = r(input);
    expect(out.text).toBe(expected);
    expect(out.counts[kind as keyof typeof out.counts]).toBe(1);
  });

  it('known names are replaced as whole words, case-insensitively, including multi-part names', () => {
    expect(r('Hi Ama, this is KOFI Mensah. Amanda is my sister.', ['Ama', 'Kofi Mensah']).text).toBe('Hi [NAME], this is [NAME] [NAME]. Amanda is my sister.');
  });

  it('names with regex characters or accents are handled and nothing throws', () => {
    expect(() => r('hello', ['(a+', '[x', '\\'])).not.toThrow();
    expect(r('Ésther called', ['Ésther']).text).toBe('[NAME] called');
  });

  it('one-letter and empty names are ignored', () => expect(r('a b c', ['a', '', null as unknown as string, undefined as unknown as string]).text).toBe('a b c'));

  it('redacts several kinds in one message and counts each', () => {
    const out = r('Ama (0241234567, ama@x.com) paid with 4111111111111111 via https://pay.example.com/x', ['Ama']);
    expect(out.text).toBe('[NAME] ([PHONE], [EMAIL]) paid with [CARD] via [URL]');
    expect(out.counts).toEqual({ NAME: 1, PHONE: 1, EMAIL: 1, CARD: 1, URL: 1 });
  });
});

describe('redactText: ordinary content is left alone', () => {
  it.each([
    'How much is the 1kg bag?',
    'The 500g jar is GHS 45 and delivery to Accra is GHS 30.',
    'I want 3 of the 2 kg bags, total 1,500 cedis',
    'We open 8am to 6pm, Monday to Saturday.',
    'order #123 is ready',
    'ship on 12-10 or 13/10',
    'Can I get 2 bags? Maybe 10 later.',
    'ok',
    '',
  ])('unchanged: %j', (s) => expect(r(s).text).toBe(s));

  it('a short code glued to letters is not treated as a phone number', () => {
    expect(r('use code ABC1234567890X today').text).toContain('ABC1234567890X');
  });

  it('a 16-digit number that fails the Luhn check is not a card, but is still removed as a number', () => {
    const out = r('ref 1234567890123456 ok');
    expect(out.counts).toEqual({ NUMBER: 1 });
    expect(out.text).toBe('ref [NUMBER] ok');
  });

  it('null and undefined become the empty string', () => {
    expect(redactText(null)).toEqual({ text: '', counts: {} });
    expect(redactText(undefined)).toEqual({ text: '', counts: {} });
  });

  it('strips control characters', () => expect(r('a\u0000b\u0007c').text).toBe('abc'));
});

describe('redactText: properties', () => {
  const samples = ['call 0241234567 or mail a@b.com', 'card 4111 1111 1111 1111', 'visit https://x.com/a?b=c', 'Ama and Kofi', 'plain words only'];
  it('is idempotent: redacting redacted text changes nothing', () => {
    for (const s of samples) {
      const once = r(s, ['Ama', 'Kofi']).text;
      expect(r(once, ['Ama', 'Kofi']).text).toBe(once);
    }
  });
  it('never leaves a digit run of eight or more in the output', () => {
    for (const s of ['12345678', '0241234567', '+233 24 123 4567', '4111 1111 1111 1111', 'a 99999999 b 88888888']) {
      expect(r(s).text).not.toMatch(/\d{8}/);
    }
  });
  it('REDACTION_VERSION is set', () => expect(REDACTION_VERSION).toBe('1'));
  it('mergeCounts adds counts per kind', () => expect(mergeCounts({ PHONE: 1 }, { PHONE: 2, EMAIL: 1 })).toEqual({ PHONE: 3, EMAIL: 1 }));
});

describe('redactText: bounded work on hostile input', () => {
  const timed = (s: string) => { const t = Date.now(); const out = r(s); return { out, ms: Date.now() - t }; };

  it('text over the limit is cut and marked, never scanned in full', () => {
    const { out } = timed('word '.repeat(5000));
    expect(out.text.length).toBeLessThanOrEqual(MAX_REDACT_INPUT + CUT_MARKER.length);
    expect(out.text.endsWith(CUT_MARKER)).toBe(true);
  });
  it.each([
    ['a long run that almost matches a hex token', 'a'.repeat(7999) + 'g'],
    ['a long run of digits and spaces', '1 '.repeat(4000)],
    ['many @ signs', '@'.repeat(8000)],
    ['a long local part with no domain', 'a'.repeat(8000) + '@'],
    ['many dots and hyphens', '.-'.repeat(4000)],
    ['a long url-like string', 'http://' + 'a'.repeat(7990)],
  ])('%s is handled quickly', (_label, input) => {
    const { ms } = timed(input);
    expect(ms).toBeLessThan(1500);
  });
});
