/**
 * AI Test Chat ("chat as a customer with the AI") talks to the AI through the real inbound pipeline using a synthetic contact.
 * That contact's number comes from a RESERVED range no real recipient can have: "+000" followed by 10 digits. A real number starts
 * with a country code and no country code begins with 0, so this range can never be a customer. Every layer that could hand a
 * message to a messaging provider (the backend's provider clients, the worker's direct sends) refuses it, so a simulated
 * conversation cannot reach a provider by any path: not by a retry, a campaign, an automation or a background job.
 *
 * The identity is the number alone, deliberately. A tenant user can edit a contact's custom fields, so a flag stored there could
 * silently stop a real customer's messages; nobody can give a real customer a number in the reserved range.
 */
export const SIMULATED_PHONE_PREFIX = '000';

const SIMULATED_PHONE = /^000\d{10}$/;

/** The synthetic number for a seed (for Test Chat, the user's id): stable per seed, always inside the reserved range. */
export function simulatedPhoneFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `+${SIMULATED_PHONE_PREFIX}${hash.toString().padStart(10, '0').slice(0, 10)}`;
}

/** True only for a number in the reserved range, in any formatting ("+000…", "000…", with spaces or dashes). Never true for a non-string. */
export function isSimulatedPhone(phone: unknown): boolean {
  return typeof phone === 'string' && SIMULATED_PHONE.test(phone.replace(/\D/g, ''));
}

export class SimulatedRecipientError extends Error {
  readonly code = 'SIMULATED_RECIPIENT';
  constructor() {
    super('This is a simulated test recipient: nothing is sent to messaging providers.');
    this.name = 'SimulatedRecipientError';
  }
}

/** Call before ANY provider send. Throws before a credential is read or a request is built. */
export function assertNotSimulatedRecipient(to: unknown): void {
  if (isSimulatedPhone(to)) throw new SimulatedRecipientError();
}
