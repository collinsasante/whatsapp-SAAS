import * as crypto from 'crypto';
import { SigningApp, decideSignature, evaluateSignature, extractWabaIds, resolveSignatureMode } from './signature-policy.util';

const sign = (body: Buffer, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const body = (entry: unknown[]) => Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry }));

const A: SigningApp = { appId: '1001', secret: 'secret-of-app-A-0123456789', wabaIds: new Set(['111111', '222222']) };
const B: SigningApp = { appId: '2002', secret: 'secret-of-app-B-0123456789', wabaIds: new Set(['333333']) };
const apps = [A, B];

describe('extractWabaIds', () => {
  it('keeps numeric ids, drops everything else, and de-duplicates', () => {
    expect(extractWabaIds([{ id: '111111' }, { id: '111111' }, { id: 'abc' }, { id: 42 }, null, {}, { id: '9'.repeat(40) }])).toEqual(['111111']);
  });
  it('is safe on anything that is not an array', () => {
    for (const v of [undefined, null, 'x', 5, {}]) expect(extractWabaIds(v)).toEqual([]);
  });
  it('looks at no more than 20 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(100000 + i) }));
    expect(extractWabaIds(many)).toHaveLength(20);
  });
});

describe('resolveSignatureMode', () => {
  it('production defaults to observe: it never rejects unless enforce is asked for explicitly', () => {
    expect(resolveSignatureMode(undefined, 'production')).toEqual({ mode: 'observe', explicit: false });
    expect(resolveSignatureMode('', 'production').mode).toBe('observe');
  });
  it('outside production the long-standing behaviour is kept (verify when a secret exists)', () => {
    expect(resolveSignatureMode(undefined, 'development').mode).toBe('enforce');
    expect(resolveSignatureMode(undefined, 'test').mode).toBe('enforce');
  });
  it('an explicit value wins, case and spaces ignored', () => {
    expect(resolveSignatureMode(' ENFORCE ', 'production')).toEqual({ mode: 'enforce', explicit: true });
    expect(resolveSignatureMode('off', 'production').mode).toBe('off');
    expect(resolveSignatureMode('observe', 'development').mode).toBe('observe');
  });
  it('a typo can never turn enforcement on in production, and is reported', () => {
    expect(resolveSignatureMode('enforced', 'production')).toEqual({ mode: 'observe', explicit: false, ignoredValue: 'enforced' });
  });
});

describe('evaluateSignature', () => {
  it('accepts a request signed by the app that owns the WABA', () => {
    const b = body([{ id: '111111' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps, wabaIds: ['111111'] })).toEqual({ outcome: 'valid', appId: '1001', wabaIds: ['111111'] });
  });

  it('verifies each app with its own secret: the second app is recognised too', () => {
    const b = body([{ id: '333333' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, B.secret), apps, wabaIds: ['333333'] }).appId).toBe('2002');
  });

  it('a genuine signature from the wrong app does not vouch for another app\'s WABA (a leaked secret cannot forge across apps)', () => {
    const b = body([{ id: '333333' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps, wabaIds: ['333333'] })).toEqual({ outcome: 'app_not_mapped', appId: '1001', wabaIds: ['333333'] });
  });

  it('one body naming WABAs of two apps is not vouched for by either alone', () => {
    const b = body([{ id: '111111' }, { id: '333333' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps, wabaIds: ['111111', '333333'] }).outcome).toBe('app_not_mapped');
  });

  it('a WABA served by two apps accepts either app\'s signature', () => {
    const both: SigningApp[] = [{ ...A, wabaIds: new Set(['555555']) }, { ...B, wabaIds: new Set(['555555']) }];
    const b = body([{ id: '555555' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps: both, wabaIds: ['555555'] }).outcome).toBe('valid');
    expect(evaluateSignature({ rawBody: b, header: sign(b, B.secret), apps: both, wabaIds: ['555555'] }).outcome).toBe('valid');
  });

  it('a WABA that no app is mapped to is app_not_mapped even with a genuine signature', () => {
    const b = body([{ id: '999999' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps, wabaIds: ['999999'] }).outcome).toBe('app_not_mapped');
  });

  it('a forged or altered request is invalid', () => {
    const b = body([{ id: '111111' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, 'attacker'), apps, wabaIds: ['111111'] }).outcome).toBe('invalid');
    expect(evaluateSignature({ rawBody: body([{ id: '111111', x: 1 }]), header: sign(b, A.secret), apps, wabaIds: ['111111'] }).outcome).toBe('invalid');
    expect(evaluateSignature({ rawBody: b, header: 'sha256=zz', apps, wabaIds: ['111111'] }).outcome).toBe('invalid');
  });

  it('a missing or malformed header, or a missing raw body, is missing_signature', () => {
    const b = body([{ id: '111111' }]);
    for (const header of [undefined, '', 'md5=abc', 'abc']) expect(evaluateSignature({ rawBody: b, header, apps, wabaIds: ['111111'] }).outcome).toBe('missing_signature');
    expect(evaluateSignature({ rawBody: undefined, header: sign(b, A.secret), apps, wabaIds: [] }).outcome).toBe('missing_signature');
  });

  it('with nothing registered nothing can be concluded', () => {
    const b = body([]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps: [], wabaIds: [] }).outcome).toBe('no_secrets');
  });

  it('a payload naming no WABA, genuinely signed, is valid_no_waba', () => {
    const b = body([]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, A.secret), apps, wabaIds: [] }).outcome).toBe('valid_no_waba');
  });

  it('the legacy single secret ("all") covers every WABA, so a one-app install behaves as before', () => {
    const legacy: SigningApp = { appId: 'env:WHATSAPP_APP_SECRET', secret: 'legacy-secret-0123456789', wabaIds: 'all' };
    const b = body([{ id: '777777' }]);
    expect(evaluateSignature({ rawBody: b, header: sign(b, legacy.secret), apps: [legacy], wabaIds: ['777777'] })).toMatchObject({ outcome: 'valid', appId: 'env:WHATSAPP_APP_SECRET' });
  });
});

describe('decideSignature', () => {
  const outcomes = ['valid', 'valid_no_waba', 'app_not_mapped', 'invalid', 'missing_signature', 'no_secrets'] as const;

  it('observe and off never reject anything, whatever the outcome', () => {
    for (const mode of ['observe', 'off'] as const) for (const o of outcomes) expect(decideSignature(mode, o)).toEqual({ accept: true, degraded: false });
  });

  it('enforce accepts only verified requests', () => {
    expect(outcomes.filter((o) => decideSignature('enforce', o).accept && !decideSignature('enforce', o).degraded)).toEqual(['valid', 'valid_no_waba']);
    for (const o of ['app_not_mapped', 'invalid', 'missing_signature'] as const) expect(decideSignature('enforce', o)).toEqual({ accept: false, degraded: false });
  });

  it('enforce with no registered secret lets requests through and says so (a self-lockout guard), instead of refusing every tenant', () => {
    expect(decideSignature('enforce', 'no_secrets')).toEqual({ accept: true, degraded: true });
  });
});
