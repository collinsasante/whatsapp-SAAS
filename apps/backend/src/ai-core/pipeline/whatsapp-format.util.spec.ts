import { sanitizeForWhatsApp, sanitizeForMessenger } from './whatsapp-format.util';

describe('sanitizeForWhatsApp', () => {
  it('converts **bold** to WhatsApp *bold*', () => {
    expect(sanitizeForWhatsApp('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to WhatsApp *bold*', () => {
    expect(sanitizeForWhatsApp('This is __bold__ text')).toBe('This is *bold* text');
  });

  it('handles multiple bold segments in one message', () => {
    expect(sanitizeForWhatsApp('**First** and **second**')).toBe('*First* and *second*');
  });

  it('leaves already-correct WhatsApp bold (single asterisk) untouched', () => {
    expect(sanitizeForWhatsApp('This is *already correct*')).toBe('This is *already correct*');
  });

  it('leaves WhatsApp italic (single underscore) untouched', () => {
    expect(sanitizeForWhatsApp('This is _italic_ text')).toBe('This is _italic_ text');
  });

  it('cleans up malformed/mismatched asterisk runs (the reported bug: ***text**)', () => {
    expect(sanitizeForWhatsApp('***jskd**')).toBe('*jskd*');
  });

  it('converts a markdown link to plain "text: url"', () => {
    expect(sanitizeForWhatsApp('Check our [website](https://example.com) for more')).toBe('Check our website: https://example.com for more');
  });

  it('converts a markdown header to a bold line', () => {
    expect(sanitizeForWhatsApp('## Order Summary\nYour total is $10')).toBe('*Order Summary*\nYour total is $10');
  });

  it('leaves plain text with no markdown untouched', () => {
    expect(sanitizeForWhatsApp('Hello, how can I help you today?')).toBe('Hello, how can I help you today?');
  });

  it('handles a realistic mixed response', () => {
    const input = "Your order is **confirmed**! Check the [tracking page](https://track.example.com) for updates.\n## Next Steps\nWe'll notify you when it ships.";
    const result = sanitizeForWhatsApp(input);
    expect(result).toContain('*confirmed*');
    expect(result).toContain('tracking page: https://track.example.com');
    expect(result).toContain('*Next Steps*');
    expect(result).not.toContain('**');
    expect(result).not.toContain('##');
  });
});

describe('sanitizeForMessenger', () => {
  it('strips **bold** entirely (Messenger has no bold syntax)', () => {
    expect(sanitizeForMessenger('This is **bold** text')).toBe('This is bold text');
  });

  it('strips __bold__ entirely', () => {
    expect(sanitizeForMessenger('This is __bold__ text')).toBe('This is bold text');
  });

  it('strips WhatsApp-style single-asterisk emphasis too', () => {
    expect(sanitizeForMessenger('This is *emphasized* text')).toBe('This is emphasized text');
  });

  it('converts a markdown link to plain "text: url"', () => {
    expect(sanitizeForMessenger('Check our [website](https://example.com) for more')).toBe('Check our website: https://example.com for more');
  });

  it('converts a markdown header to a plain line', () => {
    expect(sanitizeForMessenger('## Order Summary\nYour total is $10')).toBe('Order Summary\nYour total is $10');
  });

  it('leaves plain text with no markdown untouched', () => {
    expect(sanitizeForMessenger('Hello, how can I help you today?')).toBe('Hello, how can I help you today?');
  });

  it('handles a realistic mixed response with no leftover markdown syntax', () => {
    const input = "Your order is **confirmed**! Check the [tracking page](https://track.example.com) for updates.\n## Next Steps\nWe'll notify you when it ships.";
    const result = sanitizeForMessenger(input);
    expect(result).toContain('confirmed');
    expect(result).toContain('tracking page: https://track.example.com');
    expect(result).toContain('Next Steps');
    expect(result).not.toContain('*');
    expect(result).not.toContain('#');
  });
});
