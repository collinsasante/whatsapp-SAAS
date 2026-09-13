import { normalizePhone } from '@whatsapp-platform/shared-utils';

/**
 * Pilot-testing restriction: when a tenant has TenantSettings.aiRestrictedToPhone
 * set, AI is available to that one contact only -- every other contact is treated
 * as if AI were off entirely, regardless of aiEnabled/aiMode/takeover settings.
 * Null (the default) means no restriction -- zero behavior change for every
 * tenant until this is explicitly set. Pulled out of handleInbound's dispatch
 * logic for direct unit coverage, same reasoning as isAgentAway.
 */
export function isAiAllowedForContact(restrictedToPhone: string | null | undefined, contactPhone: string): boolean {
  if (!restrictedToPhone) return true;
  return normalizePhone(restrictedToPhone) === contactPhone;
}
