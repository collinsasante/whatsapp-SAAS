import { signOAuthState, verifyOAuthState } from './oauth-state.util';

const SECRET = 'test-oauth-state-secret';
const PAYLOAD = { tenantId: 't1', provider: 'facebook', userId: 'u1' };

describe('oauth-state.util', () => {
  it('round-trips a correctly signed state', () => {
    const token = signOAuthState(PAYLOAD, SECRET);
    const verified = verifyOAuthState(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.tenantId).toBe('t1');
    expect(verified?.provider).toBe('facebook');
    expect(verified?.userId).toBe('u1');
  });

  it('rejects a state signed with the wrong secret', () => {
    const token = signOAuthState(PAYLOAD, SECRET);
    expect(verifyOAuthState(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signOAuthState(PAYLOAD, SECRET);
    const [encoded] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...PAYLOAD, tenantId: 'attacker-tenant', exp: Date.now() + 60_000 })).toString('base64url');
    const forged = token.replace(encoded, tamperedPayload);
    expect(verifyOAuthState(forged, SECRET)).toBeNull();
  });

  it('rejects an expired state', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signOAuthState(PAYLOAD, SECRET);
    jest.setSystemTime(new Date('2026-01-01T00:06:00Z')); // 6 min later, past the 5-min TTL
    expect(verifyOAuthState(token, SECRET)).toBeNull();
    jest.useRealTimers();
  });

  it('rejects a missing state', () => {
    expect(verifyOAuthState(undefined, SECRET)).toBeNull();
  });

  it('rejects malformed garbage without throwing', () => {
    expect(() => verifyOAuthState('not-a-real-token', SECRET)).not.toThrow();
    expect(verifyOAuthState('not-a-real-token', SECRET)).toBeNull();
  });

  it('rejects a token with no signature separator', () => {
    expect(verifyOAuthState('justsomebase64withnodot', SECRET)).toBeNull();
  });
});
