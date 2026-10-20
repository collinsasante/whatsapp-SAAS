import * as crypto from 'crypto';
import { checkWebhookSignature, verifyWhatsAppSignature } from './webhook-signature.util';

const SECRET = 'test-app-secret';

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyWhatsAppSignature', () => {
  it('accepts a correctly signed payload', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const sig = sign(body, SECRET);
    expect(verifyWhatsAppSignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const sig = sign(body, 'wrong-secret');
    expect(verifyWhatsAppSignature(body, sig, SECRET)).toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const original = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
    const sig = sign(original, SECRET);
    const tampered = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: ['injected'] }));
    expect(verifyWhatsAppSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    const body = Buffer.from('{}');
    const sig = sign(body, SECRET);
    expect(verifyWhatsAppSignature(body, sig, undefined)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}');
    expect(verifyWhatsAppSignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects a missing raw body', () => {
    expect(verifyWhatsAppSignature(undefined, 'sha256=abc', SECRET)).toBe(false);
  });

  it('rejects a signature without the sha256= prefix', () => {
    const body = Buffer.from('{}');
    const rawHex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyWhatsAppSignature(body, rawHex, SECRET)).toBe(false);
  });

  it('rejects non-hex garbage in the signature without throwing', () => {
    const body = Buffer.from('{}');
    expect(() => verifyWhatsAppSignature(body, 'sha256=not-hex-at-all!!', SECRET)).not.toThrow();
    expect(verifyWhatsAppSignature(body, 'sha256=not-hex-at-all!!', SECRET)).toBe(false);
  });

  it('rejects a truncated (shorter) signature without throwing', () => {
    const body = Buffer.from('{}');
    expect(() => verifyWhatsAppSignature(body, 'sha256=abcd', SECRET)).not.toThrow();
    expect(verifyWhatsAppSignature(body, 'sha256=abcd', SECRET)).toBe(false);
  });
});

describe('checkWebhookSignature', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

  it('is "unconfigured" when no secret is set, whatever the request carries', () => {
    expect(checkWebhookSignature(body, sign(body, SECRET), undefined)).toBe('unconfigured');
    expect(checkWebhookSignature(body, undefined, '')).toBe('unconfigured');
  });

  it('is "valid" for a correct signature and "invalid" for every other case once a secret is set', () => {
    expect(checkWebhookSignature(body, sign(body, SECRET), SECRET)).toBe('valid');
    expect(checkWebhookSignature(body, sign(body, 'wrong'), SECRET)).toBe('invalid');
    expect(checkWebhookSignature(body, undefined, SECRET)).toBe('invalid');
    expect(checkWebhookSignature(undefined, sign(body, SECRET), SECRET)).toBe('invalid');
    expect(checkWebhookSignature(Buffer.from('{"tampered":true}'), sign(body, SECRET), SECRET)).toBe('invalid');
  });
});
