/**
 * Baileys 6.17 surfaces a message it could not read as `messageStubType = CIPHERTEXT (2)` with no
 * `message` and a reason in `messageStubParameters[0]` (WAProto StubType.CIPHERTEXT;
 * decode-wa-message.js). Two cases matter:
 *  - 'Message absent from node': WhatsApp sent nothing readable to this linked device. This is the
 *    normal result for view-once media, which is only viewable on the phone. We show a placeholder.
 *  - a decryption error: WhatsApp usually re-sends, and the retry arrives with the same id, so we do
 *    not surface it (a placeholder would make the real message look like a duplicate).
 */
export const CIPHERTEXT_STUB_TYPE = 2;
export const NO_MESSAGE_FOUND_TEXT = 'Message absent from node';
export const UNAVAILABLE_PLACEHOLDER = '[Message not available here. It may be view-once. Open it on your phone]';
/** Distinct from the real message id so a later successful delivery of the same message is never treated as a duplicate. */
export const UNAVAILABLE_ID_SUFFIX = ':unavailable';

export type UndecryptableOutcome = { action: 'ignore'; reason: 'not-a-stub' | 'decrypt-error' } | { action: 'placeholder'; providerMessageId: string };

export function classifyUndecryptable(
  msg: { key: { id?: string | null }; messageStubType?: number | null; messageStubParameters?: Array<string | null> | null },
): UndecryptableOutcome {
  if (msg.messageStubType !== CIPHERTEXT_STUB_TYPE || !msg.key.id) return { action: 'ignore', reason: 'not-a-stub' };
  if (msg.messageStubParameters?.[0] !== NO_MESSAGE_FOUND_TEXT) return { action: 'ignore', reason: 'decrypt-error' };
  return { action: 'placeholder', providerMessageId: `${msg.key.id}${UNAVAILABLE_ID_SUFFIX}` };
}
