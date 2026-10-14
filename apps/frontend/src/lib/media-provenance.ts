/**
 * "Sent by agents" is decided from message ownership, never from file names or URLs:
 * an OUTBOUND message with a recorded human/system sender id. Outbound messages with no
 * sender (legacy rows, in-flight optimistic bubbles) are NOT guessed to be agent media.
 * Known limit: the AI agent is also a sender id, so AI-sent media can appear here until the
 * message payload carries `isAiAgent`.
 */
export interface ProvenanceMessage {
  direction: string;
  senderId?: string | null;
}

export function isAgentSentMedia(m: ProvenanceMessage): boolean {
  return m.direction === 'OUTBOUND' && !!m.senderId;
}
