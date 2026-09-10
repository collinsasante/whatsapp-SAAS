import { redactSecrets } from './redact.util';

describe('redactSecrets', () => {
  it('redacts keys matching common secret patterns at any depth', () => {
    const input = {
      event: 'charge.success',
      signature: 'abc',
      authorization: 'Bearer xyz',
      nested: { apiKey: 'sk_live_123', password: 'p@ss', token: 't1' },
    };

    const out = redactSecrets(input) as typeof input;

    expect(out.signature).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.nested.apiKey).toBe('[REDACTED]');
    expect(out.nested.password).toBe('[REDACTED]');
    expect(out.nested.token).toBe('[REDACTED]');
  });

  it('leaves ordinary business data untouched', () => {
    const input = { orderId: 'o1', amount: 100, currency: 'GHS', metadata: { gatewayReference: 'r1' } };
    expect(redactSecrets(input)).toEqual(input);
  });

  it('handles arrays and null/undefined without throwing', () => {
    expect(redactSecrets([{ secret: 'x' }, { orderId: 'o1' }])).toEqual([{ secret: '[REDACTED]' }, { orderId: 'o1' }]);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });
});
