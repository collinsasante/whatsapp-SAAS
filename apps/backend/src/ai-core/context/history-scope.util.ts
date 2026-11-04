import { Prisma } from '@prisma/client';

/**
 * Which stored rows may become conversation turns. Only text the customer actually wrote, or that the business sent as text:
 *  - TEXT rows, both directions;
 *  - INBOUND INTERACTIVE (the title of a list/button the customer tapped) and INBOUND LOCATION (name/address they shared);
 *  - INBOUND IMAGE/VIDEO that have no body but carry the customer's caption (the caption is read from mediaCaption).
 *  - INBOUND AUDIO / IMAGE that have a COMPLETED machine transcript / description, but only for a workspace that has switched that feature on
 *    (voiceTranscriptionEnabled / imageUnderstandingEnabled). That text is generated, not written by the customer; the loader labels it as such.
 * Never included: NOTE (internal agent notes), TEMPLATE, CONTACTS, STICKER, an AUDIO or IMAGE without a completed enrichment, DOCUMENT (its
 * mediaCaption is a file name), nor any URL, MIME type or other attachment metadata.
 */
export const HISTORY_ROW_FILTER: Prisma.MessageWhereInput = {
  OR: [
    { type: 'TEXT', content: { not: null } },
    { direction: 'INBOUND', type: { in: ['INTERACTIVE', 'LOCATION'] }, content: { not: null } },
    { direction: 'INBOUND', type: { in: ['IMAGE', 'VIDEO'] }, content: null, mediaCaption: { not: null } },
    {
      direction: 'INBOUND', type: 'AUDIO', content: null,
      tenant: { settings: { is: { voiceTranscriptionEnabled: true } } },
      enrichments: { some: { kind: 'TRANSCRIPT', status: 'COMPLETED', text: { not: '' } } },
    },
    {
      direction: 'INBOUND', type: 'IMAGE', content: null,
      tenant: { settings: { is: { imageUnderstandingEnabled: true } } },
      enrichments: { some: { kind: 'IMAGE_ANALYSIS', status: 'COMPLETED', text: { not: '' } } },
    },
  ],
};

/**
 * Builds the `where` for the AI's conversation-history fetch. Two scopes, both always
 * tenant-scoped:
 *  - buildHistoryWhere: contact scope (all of a contact's conversations with the tenant),
 *    used ONLY by the legacy responder, which already read contact-scoped history on main.
 *  - buildConversationHistoryWhere: the current conversation only, used by VerzAI v2 and
 *    Commerce AI (their original behavior, plus the tenant boundary).
 *
 * Fail-closed by construction: Prisma silently drops a filter whose value is
 * `undefined`, so `{ conversation: { contactId: undefined } }` would match every
 * conversation. This never emits an absent filter -- `tenantId` is always present, and
 * the narrowing key is either a verified contactId or the current conversation's id.
 *
 * Returns `null` when the caller could not verify the conversation belongs to the
 * tenant (lookup returned null); callers must then use an empty history, not query.
 */
export function buildHistoryWhere(
  tenantId: string,
  conversation: { id: string; contactId?: string | null } | null | undefined,
): Prisma.MessageWhereInput | null {
  if (!tenantId || !conversation || !conversation.id) return null;

  const base: Prisma.MessageWhereInput = { tenantId, ...HISTORY_ROW_FILTER };
  const contactId = conversation.contactId;
  if (typeof contactId === 'string' && contactId.trim().length > 0) {
    return { ...base, conversation: { tenantId, contactId } };
  }
  return { ...base, conversationId: conversation.id };
}

/**
 * Per-conversation scope (VerzAI v2 and Commerce AI): the message must belong to this
 * tenant AND this conversation. Returns `null` for an empty tenant or conversation id so a
 * caller can never issue a query whose narrowing key is blank/absent.
 */
export function buildConversationHistoryWhere(tenantId: string, conversationId: string | null | undefined): Prisma.MessageWhereInput | null {
  if (!tenantId || !conversationId) return null;
  return { tenantId, conversationId, ...HISTORY_ROW_FILTER };
}
