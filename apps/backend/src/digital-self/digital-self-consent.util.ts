import type { DigitalSelfConsentStatus } from '@prisma/client';

/**
 * The wording an agent agrees to. When the text changes materially, bump this: every earlier GRANTED decision then stops counting
 * (hasValidConsent compares versions) until the agent agrees to the new wording, and the prompt appears again.
 */
export const DIGITAL_SELF_CONSENT_VERSION = 'ds-consent-v1';

export interface ConsentFields {
  consentStatus: DigitalSelfConsentStatus;
  consentVersion: string | null;
}

/**
 * The single rule used everywhere a Digital Self is learned from, used in a reply, previewed or assigned: the agent themselves said yes, to the
 * wording that is current now. PENDING, DECLINED, WITHDRAWN and a stale version all mean no. Pure, so every call site gives the same answer.
 */
export function hasValidConsent(self: ConsentFields | null | undefined, currentVersion: string = DIGITAL_SELF_CONSENT_VERSION): boolean {
  return !!self && self.consentStatus === 'GRANTED' && self.consentVersion === currentVersion;
}

/** What the agent still needs to do, for the interface: nothing, decide for the first time, or re-confirm after the wording changed. */
export type ConsentNeed = 'none' | 'decide' | 'reconfirm';

export function consentNeed(self: ConsentFields, currentVersion: string = DIGITAL_SELF_CONSENT_VERSION): ConsentNeed {
  if (self.consentStatus === 'PENDING') return 'decide';
  if (self.consentStatus === 'GRANTED' && self.consentVersion !== currentVersion) return 'reconfirm';
  return 'none';
}

export type ConsentDecision = 'ACCEPT' | 'DECLINE' | 'WITHDRAW';

/** The status a decision produces, or null when it makes no sense from the current one (declining after having agreed is a withdrawal). */
export function nextConsentStatus(current: DigitalSelfConsentStatus, decision: ConsentDecision): DigitalSelfConsentStatus | null {
  switch (decision) {
    case 'ACCEPT':
      return 'GRANTED';
    case 'DECLINE':
      return current === 'PENDING' ? 'DECLINED' : null;
    case 'WITHDRAW':
      return current === 'GRANTED' ? 'WITHDRAWN' : null;
  }
}
