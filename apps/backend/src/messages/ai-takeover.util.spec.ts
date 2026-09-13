import { isAgentAway, AI_TAKEOVER_AWAY_MS } from './ai-takeover.util';

const NOW = new Date('2026-09-13T12:00:00.000Z').getTime();

describe('isAgentAway', () => {
  it('is false when the conversation has no assignee at all', () => {
    expect(isAgentAway(null, true, true, NOW)).toBe(false);
    expect(isAgentAway(undefined, true, true, NOW)).toBe(false);
  });

  it('is false when the "assignee" is the AI agent itself, not a human', () => {
    expect(isAgentAway({ isAiAgent: true, lastSeenAt: null }, true, true, NOW)).toBe(false);
  });

  it('is false when the tenant has not opted into takeover, no matter how long the agent has been away', () => {
    const longAgo = new Date(NOW - AI_TAKEOVER_AWAY_MS * 10).toISOString();
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: longAgo }, false, true, NOW)).toBe(false);
  });

  it('is false when AI is not enabled for the tenant at all, even with takeover on and agent away', () => {
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: null }, true, false, NOW)).toBe(false);
  });

  it('is false when the agent has been seen recently', () => {
    const justNow = new Date(NOW - 60_000).toISOString(); // 1 minute ago
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: justNow }, true, true, NOW)).toBe(false);
  });

  it('is true when the agent has never been seen (lastSeenAt null) and takeover is on', () => {
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: null }, true, true, NOW)).toBe(true);
  });

  it('is true when the agent was last seen more than the threshold ago', () => {
    const wayBefore = new Date(NOW - AI_TAKEOVER_AWAY_MS - 1).toISOString();
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: wayBefore }, true, true, NOW)).toBe(true);
  });

  it('is false right at the threshold boundary (not yet strictly over)', () => {
    const exactlyAtThreshold = new Date(NOW - AI_TAKEOVER_AWAY_MS).toISOString();
    expect(isAgentAway({ isAiAgent: false, lastSeenAt: exactlyAtThreshold }, true, true, NOW)).toBe(false);
  });
});
