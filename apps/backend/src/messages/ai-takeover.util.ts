/** AI takeover when the assigned human agent has gone quiet -- opt-in per tenant
 * (TenantSettings.aiTakeoverWhenAgentAway), off by default everywhere. Long enough
 * that an agent actively reading/typing isn't interrupted, short enough that a
 * customer isn't left waiting indefinitely. See messages.service.ts's handleInbound. */
export const AI_TAKEOVER_AWAY_MS = 15 * 60 * 1000;

export interface TakeoverAssignee {
  isAiAgent?: boolean;
  lastSeenAt?: Date | string | null;
}

/**
 * True when a conversation is owned by a real (non-AI) human agent, this tenant
 * has opted into takeover, AI is enabled for the tenant at all, and that agent
 * hasn't been seen recently enough. Pulled out of handleInbound's dispatch logic
 * so the actual decision rule has direct unit coverage, independent of mocking
 * the rest of that much larger method.
 */
export function isAgentAway(
  assignedTo: TakeoverAssignee | null | undefined,
  takeoverEnabled: boolean,
  aiEnabledForTenant: boolean,
  now: number = Date.now(),
): boolean {
  const humanOwned = !!assignedTo && !assignedTo.isAiAgent;
  if (!humanOwned || !takeoverEnabled || !aiEnabledForTenant) return false;
  if (!assignedTo!.lastSeenAt) return true;
  return now - new Date(assignedTo!.lastSeenAt).getTime() > AI_TAKEOVER_AWAY_MS;
}
