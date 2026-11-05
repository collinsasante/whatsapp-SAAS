import { DIGITAL_SELF_CONSENT_VERSION } from '../digital-self-consent.util';

/** Test fixtures: the consent fields of an agent who has said yes to the current wording. Spread into a hand-built Digital Self row. */
export const CONSENTED = {
  consentStatus: 'GRANTED' as const,
  consentVersion: DIGITAL_SELF_CONSENT_VERSION,
  consentDecidedAt: new Date('2026-11-01T09:00:00Z'),
  consentDecidedById: null as string | null,
};

/** Test fixtures against a real database: records the agent's own agreement exactly as the API would (decider = the agent). */
export async function grantConsentInDb(
  db: { digitalSelf: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>; findUniqueOrThrow(args: { where: { id: string } }): Promise<{ userId: string }> } },
  digitalSelfId: string,
): Promise<void> {
  const row = await db.digitalSelf.findUniqueOrThrow({ where: { id: digitalSelfId } });
  await db.digitalSelf.update({
    where: { id: digitalSelfId },
    data: { consentStatus: 'GRANTED', consentVersion: DIGITAL_SELF_CONSENT_VERSION, consentDecidedAt: new Date(), consentDecidedById: row.userId },
  });
}
