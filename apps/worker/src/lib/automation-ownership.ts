/**
 * Ownership policy for automation actions that change who handles a conversation
 * (resolve / assign / unassign). Automations are tenant-configured and legitimate, but
 * they must not silently close or take a chat away from a human agent who is actively
 * working it -- the same protection the AI has. Mirrors backend AI_TAKEOVER_AWAY_MS (3h).
 */
export const HUMAN_ACTIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface ConversationOwner {
  isAiAgent: boolean;
  lastSeenAt: Date | null;
}

export function automationMayChangeOwnership(owner: ConversationOwner | null | undefined, now: number = Date.now()): boolean {
  if (!owner || owner.isAiAgent) return true;
  if (!owner.lastSeenAt) return true; // never seen: nobody is demonstrably working it
  return now - owner.lastSeenAt.getTime() > HUMAN_ACTIVE_WINDOW_MS;
}
