import { buildAttentionItems, AttentionInput } from './dashboard-attention.util';

const empty: AttentionInput = {
  backlog: { open: 0, unassigned: 0, slaBreached: 0, awaitingReply: 0, awaitingReplyOverHour: 0, oldestWaitingSeconds: null, waiting: [] },
  slaBreachedRequested: null,
  failedDeliveries: { count: 0, samples: [] },
  failedCampaigns: { count: 0, names: [] },
  channelProblems: { count: 0, names: [] },
  days: 7,
};

describe('buildAttentionItems', () => {
  it('returns nothing when nothing needs attention', () => {
    expect(buildAttentionItems(empty)).toEqual([]);
  });

  it('links every item to the view that lists exactly those records', () => {
    const items = buildAttentionItems({
      ...empty,
      slaBreachedRequested: 1,
      backlog: { ...empty.backlog, open: 9, unassigned: 4, awaitingReply: 3, awaitingReplyOverHour: 1, oldestWaitingSeconds: 5400,
        waiting: [{ conversationId: 'c1', contactName: 'Ama', channel: 'WHATSAPP', waitingSeconds: 5400, assignedTo: null }] },
      failedDeliveries: { count: 2, samples: [{ conversationId: 'c9', contactName: null, ageSeconds: 60 }] },
      failedCampaigns: { count: 1, names: ['Promo'] },
      channelProblems: { count: 1, names: ['Page A'] },
    });
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    expect(byKind.sla_breached.href).toBe('/inbox?status=REQUESTED');
    expect(byKind.unassigned.href).toBe('/inbox?status=ACTIVE&assignee=unassigned');
    expect(byKind.awaiting_reply.href).toBe('/inbox?status=UNREPLIED');
    expect(byKind.failed_deliveries.href).toBe('/inbox?c=c9');
    expect(byKind.failed_campaigns.href).toBe('/campaigns');
    expect(byKind.channel_problems.href).toBe('/channels');
    expect(byKind.unassigned.count).toBe(4);
  });

  it('omits the reply-deadline item when deadlines are not configured', () => {
    const items = buildAttentionItems({ ...empty, slaBreachedRequested: null });
    expect(items.find((i) => i.kind === 'sla_breached')).toBeUndefined();
  });

  it('rates a four-hour wait critical, an hour warning, and a short wait informational', () => {
    const wait = (over: number, oldest: number) => buildAttentionItems({
      ...empty, backlog: { ...empty.backlog, awaitingReply: 2, awaitingReplyOverHour: over, oldestWaitingSeconds: oldest },
    })[0].severity;
    expect(wait(1, 4 * 3600)).toBe('critical');
    expect(wait(1, 2 * 3600)).toBe('warning');
    expect(wait(0, 600)).toBe('info');
  });

  it('puts the most severe items first', () => {
    const items = buildAttentionItems({
      ...empty, failedCampaigns: { count: 1, names: ['Promo'] }, channelProblems: { count: 1, names: ['Page A'] },
    });
    expect(items.map((i) => i.kind)).toEqual(['channel_problems', 'failed_campaigns']);
  });

  it('uses singular wording for one record', () => {
    const [item] = buildAttentionItems({ ...empty, slaBreachedRequested: 1 });
    expect(item.title).toBe('1 request past the reply deadline');
  });
});
