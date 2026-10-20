import { Prisma } from '@prisma/client';

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

  const base: Prisma.MessageWhereInput = { tenantId, type: 'TEXT', content: { not: null } };
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
  return { tenantId, conversationId, type: 'TEXT', content: { not: null } };
}
