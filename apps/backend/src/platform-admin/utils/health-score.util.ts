/**
 * Tenant health score (0-100). Weights are a starting point, not a settled
 * formula -- kept in this one function, with a documented breakdown, so
 * they're easy to see and retune later without hunting through the service.
 *
 * Signals and their max contribution:
 *  - Recent login activity (any user logged in within the last 7 days): 25
 *  - Message activity in the last 30 days (scaled, capped at 25):        25
 *  - Broadcast activity (sent a campaign in the last 30 days):           15
 *  - Team size (more than one active user):                              15
 *  - Payment status (ACTIVE full credit, PAST_DUE none, else partial):   20
 *                                                                  Total: 100
 */
export interface HealthScoreInput {
  loggedInLast7Days: boolean;
  messagesLast30Days: number;
  sentBroadcastLast30Days: boolean;
  teammateCount: number;
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED' | 'EXPIRED' | null;
}

export interface HealthScoreResult {
  score: number;
  breakdown: {
    loginActivity: number;
    messageActivity: number;
    broadcastActivity: number;
    teamSize: number;
    paymentStatus: number;
  };
}

/** Message-activity points scale linearly up to this many messages, then cap. */
const MESSAGE_ACTIVITY_CAP = 200;

export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const loginActivity = input.loggedInLast7Days ? 25 : 0;
  const messageActivity = Math.round(Math.min(input.messagesLast30Days, MESSAGE_ACTIVITY_CAP) / MESSAGE_ACTIVITY_CAP * 25);
  const broadcastActivity = input.sentBroadcastLast30Days ? 15 : 0;
  const teamSize = input.teammateCount > 1 ? 15 : 0;
  const paymentStatus = input.subscriptionStatus === 'ACTIVE' ? 20
    : input.subscriptionStatus === 'PAST_DUE' ? 0
    : input.subscriptionStatus === 'TRIAL' ? 10
    : 0;

  return {
    score: loginActivity + messageActivity + broadcastActivity + teamSize + paymentStatus,
    breakdown: { loginActivity, messageActivity, broadcastActivity, teamSize, paymentStatus },
  };
}

export interface ChurnRiskInput {
  pastDue: boolean;
  activityDropPct: number | null; // % drop vs prior 30 days; null if no prior-period baseline
  zeroActivityLast14Days: boolean;
}

/** Flags a tenant as churn-risk if any one of the three conditions holds. */
export function isChurnRisk(input: ChurnRiskInput): boolean {
  if (input.pastDue) return true;
  if (input.zeroActivityLast14Days) return true;
  if (input.activityDropPct != null && input.activityDropPct > 50) return true;
  return false;
}
