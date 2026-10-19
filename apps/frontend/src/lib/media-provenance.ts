/**
 * "Sent by agents" is decided from message ownership, never from file names or URLs:
 * an OUTBOUND message with a recorded human/system sender id. Outbound messages with no
 * sender (legacy rows, in-flight optimistic bubbles) are NOT guessed to be agent media.
 * The AI posts as a synthetic user, so it also has a sender id: the sender's isAiAgent flag excludes it.
 * Same definition as the server's Media Library "Sent by agents" filter (apps/backend media-library.query.ts).
 */
export interface ProvenanceMessage {
  direction: string;
  senderId?: string | null;
  sender?: { id?: string; isAiAgent?: boolean | null } | null;
}

export function isAgentSentMedia(m: ProvenanceMessage): boolean {
  if (m.direction !== 'OUTBOUND' || !m.senderId) return false;
  // The AI posts as a synthetic user. Messages loaded with their sender say so; an older payload without the
  // flag is treated as human only when the sender object is absent, never when it says "AI".
  return m.sender?.isAiAgent !== true;
}
