import { computeHealthScore, isChurnRisk, HealthScoreInput } from './health-score.util';

/** A healthy, fully-engaged tenant: logged in this week, active messaging, broadcasts, a real team, paying. */
const HEALTHY_FIXTURE: HealthScoreInput = {
  loggedInLast7Days: true,
  messagesLast30Days: 200,
  sentBroadcastLast30Days: true,
  teammateCount: 3,
  subscriptionStatus: 'ACTIVE',
};

/** A dormant, at-risk tenant: no recent login, no messages, no team, past due. */
const AT_RISK_FIXTURE: HealthScoreInput = {
  loggedInLast7Days: false,
  messagesLast30Days: 0,
  sentBroadcastLast30Days: false,
  teammateCount: 1,
  subscriptionStatus: 'PAST_DUE',
};

describe('computeHealthScore', () => {
  it('scores a fully-engaged, paying tenant at 100', () => {
    expect(computeHealthScore(HEALTHY_FIXTURE)).toEqual({
      score: 100,
      breakdown: { loginActivity: 25, messageActivity: 25, broadcastActivity: 15, teamSize: 15, paymentStatus: 20 },
    });
  });

  it('scores a dormant, past-due tenant at 0', () => {
    expect(computeHealthScore(AT_RISK_FIXTURE)).toEqual({
      score: 0,
      breakdown: { loginActivity: 0, messageActivity: 0, broadcastActivity: 0, teamSize: 0, paymentStatus: 0 },
    });
  });

  it('scales message activity linearly and caps it at the ceiling', () => {
    const half = computeHealthScore({ ...AT_RISK_FIXTURE, messagesLast30Days: 100 });
    expect(half.breakdown.messageActivity).toBe(13); // 100/200 * 25, rounded

    const overCap = computeHealthScore({ ...AT_RISK_FIXTURE, messagesLast30Days: 10_000 });
    expect(overCap.breakdown.messageActivity).toBe(25);
  });

  it('gives trial tenants partial payment-status credit, not full or zero', () => {
    const result = computeHealthScore({ ...AT_RISK_FIXTURE, subscriptionStatus: 'TRIAL' });
    expect(result.breakdown.paymentStatus).toBe(10);
  });

  it('gives no team-size credit for a solo workspace', () => {
    const result = computeHealthScore({ ...HEALTHY_FIXTURE, teammateCount: 1 });
    expect(result.breakdown.teamSize).toBe(0);
  });
});

describe('isChurnRisk', () => {
  it('flags a past-due tenant regardless of activity', () => {
    expect(isChurnRisk({ pastDue: true, activityDropPct: null, zeroActivityLast14Days: false })).toBe(true);
  });

  it('flags a tenant with zero activity in the last 14 days', () => {
    expect(isChurnRisk({ pastDue: false, activityDropPct: null, zeroActivityLast14Days: true })).toBe(true);
  });

  it('flags a tenant whose activity dropped more than 50%', () => {
    expect(isChurnRisk({ pastDue: false, activityDropPct: 60, zeroActivityLast14Days: false })).toBe(true);
  });

  it('does not flag a tenant with a drop of exactly 50%', () => {
    expect(isChurnRisk({ pastDue: false, activityDropPct: 50, zeroActivityLast14Days: false })).toBe(false);
  });

  it('does not flag a healthy, active, paying tenant', () => {
    expect(isChurnRisk({ pastDue: false, activityDropPct: 5, zeroActivityLast14Days: false })).toBe(false);
  });
});
