import { consentNeed, DIGITAL_SELF_CONSENT_VERSION, hasValidConsent, nextConsentStatus } from './digital-self-consent.util';

const V = DIGITAL_SELF_CONSENT_VERSION;

describe('hasValidConsent', () => {
  it('is true only for GRANTED at the current wording', () => {
    expect(hasValidConsent({ consentStatus: 'GRANTED', consentVersion: V })).toBe(true);
  });
  it.each(['PENDING', 'DECLINED', 'WITHDRAWN'] as const)('is false for %s, even at the current version', (consentStatus) => {
    expect(hasValidConsent({ consentStatus, consentVersion: V })).toBe(false);
  });
  it('is false when the agent agreed to older wording, or to nothing recorded', () => {
    expect(hasValidConsent({ consentStatus: 'GRANTED', consentVersion: 'ds-consent-v0' })).toBe(false);
    expect(hasValidConsent({ consentStatus: 'GRANTED', consentVersion: null })).toBe(false);
  });
  it('is false for a missing Digital Self (fail closed)', () => {
    expect(hasValidConsent(null)).toBe(false);
    expect(hasValidConsent(undefined)).toBe(false);
  });
  it('follows the version it is given, so bumping the wording invalidates earlier agreement everywhere at once', () => {
    expect(hasValidConsent({ consentStatus: 'GRANTED', consentVersion: V }, 'ds-consent-v2')).toBe(false);
  });
});

describe('consentNeed', () => {
  it('asks for a first decision only while PENDING', () => {
    expect(consentNeed({ consentStatus: 'PENDING', consentVersion: null })).toBe('decide');
  });
  it('asks to re-confirm only when an agreement predates the current wording', () => {
    expect(consentNeed({ consentStatus: 'GRANTED', consentVersion: 'ds-consent-v0' })).toBe('reconfirm');
  });
  it.each([['GRANTED', V], ['DECLINED', V], ['WITHDRAWN', V]] as const)('never asks again after a decision (%s)', (consentStatus, consentVersion) => {
    expect(consentNeed({ consentStatus, consentVersion })).toBe('none');
  });
  it('does not nag someone who declined, even if the wording has since changed', () => {
    expect(consentNeed({ consentStatus: 'DECLINED', consentVersion: 'ds-consent-v0' })).toBe('none');
  });
});

describe('nextConsentStatus', () => {
  it('accepting always results in GRANTED (including after declining or withdrawing)', () => {
    for (const from of ['PENDING', 'DECLINED', 'WITHDRAWN', 'GRANTED'] as const) expect(nextConsentStatus(from, 'ACCEPT')).toBe('GRANTED');
  });
  it('declining is a first decision; after agreeing the right action is to withdraw', () => {
    expect(nextConsentStatus('PENDING', 'DECLINE')).toBe('DECLINED');
    expect(nextConsentStatus('GRANTED', 'DECLINE')).toBeNull();
  });
  it('withdrawing only makes sense after agreeing', () => {
    expect(nextConsentStatus('GRANTED', 'WITHDRAW')).toBe('WITHDRAWN');
    for (const from of ['PENDING', 'DECLINED', 'WITHDRAWN'] as const) expect(nextConsentStatus(from, 'WITHDRAW')).toBeNull();
  });
});
