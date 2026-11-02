/**
 * Conversation rooms are namespaced by workspace. A socket can ask to join any conversation id, so the room name must include the
 * tenant taken from its verified token, never from the request: a user of workspace A who guesses a conversation id of workspace B
 * only ever joins A's (empty) room and receives nothing from B.
 */
export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;
export const userRoom = (userId: string): string => `user:${userId}`;
export const conversationRoom = (tenantId: string, conversationId: string): string => `tenant:${tenantId}:conversation:${conversationId}`;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
