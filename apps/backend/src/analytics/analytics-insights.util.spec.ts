import { buildHealth, buildInsights, compareMetric, formatDuration, InsightInput, relativeChange } from './analytics-insights.util';
import { BacklogSnapshot, Coverage, PeriodKpis } from './analytics-intelligence.types';

function kpis(overrides: Partial<PeriodKpis> = {}): PeriodKpis {
  const duration = { samples: 0, medianSeconds: null, p90Seconds: null, meanSeconds: null };
  return {
    conversations: { total: 0, newContact: 0, returningContact: 0 },
    resolved: 0, reopened: 0, newContacts: 0, activeContacts: 0, inboundMessages: 0,
    firstResponse: { ...duration, buckets: [], human: duration },
    resolution: duration,
    sla: { tracked: 0, breached: 0 },
    csat: { responses: 0, average: null },
    leads: { created: 0, qualified: 0, converted: 0 },
    orders: { byCurrency: [], refunded: 0, conversationsWithPaidOrder: 0 },
    ai: {
      engagedConversations: 0, autoReplies: 0, suggestions: 0, suggestionsSent: 0, suggestionsEdited: 0,
      suggestionsRejected: 0, averageConfidence: null, handedToPerson: 0, resolvedWithoutPerson: 0, creditsUsed: 0,
    },
    ...overrides,
  };
}

const emptyBacklog: BacklogSnapshot = {
  open: 0, unassigned: 0, slaBreached: 0, awaitingReply: 0, awaitingReplyOverHour: 0, oldestWaitingSeconds: null, waiting: [],
};
const fullCoverage: Coverage = { orders: true, leads: true, ai: true, sla: true, csat: true };

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    current: kpis(), previous: kpis(), backlog: emptyBacklog, heatmap: [], topics: [], labelledConversations: 0,
    channels: [], coverage: fullCoverage, hotLeadsOpen: 0, days: 30, ...overrides,
  };
}

const ids = (i: InsightInput) => buildInsights(i).map((x) => x.id);
const response = (median: number, samples: number) => ({
  samples, medianSeconds: median, p90Seconds: median * 2, meanSeconds: median, buckets: [],
  human: { samples: 0, medianSeconds: null, p90Seconds: null, meanSeconds: null },
});

describe('relativeChange', () => {
  it('is null from a zero baseline instead of infinity', () => {
    expect(relativeChange(5, 0)).toBeNull();
    expect(relativeChange(15, 10)).toBeCloseTo(0.5);
    expect(relativeChange(5, 10)).toBeCloseTo(-0.5);
  });
});

describe('compareMetric', () => {
  const enough = { current: 20, previous: 20 };
  it('reads a lower response time as better and a higher one as worse', () => {
    expect(compareMetric(60, 120, 'lower-is-better', enough)).toBe('better');
    expect(compareMetric(180, 120, 'lower-is-better', enough)).toBe('worse');
  });
  it('reads more resolved conversations as better (direction matters, not the sign of the change)', () => {
    expect(compareMetric(30, 20, 'higher-is-better', enough)).toBe('better');
    expect(compareMetric(10, 20, 'higher-is-better', enough)).toBe('worse');
  });
  it('treats a change within 10 percent as the same', () => {
    expect(compareMetric(105, 100, 'higher-is-better', enough)).toBe('same');
  });
  it('refuses to compare when either period has too few samples or a value is missing', () => {
    expect(compareMetric(60, 120, 'lower-is-better', { current: 3, previous: 50 })).toBe('insufficient');
    expect(compareMetric(60, 120, 'lower-is-better', { current: 50, previous: 9 })).toBe('insufficient');
    expect(compareMetric(null, 120, 'lower-is-better', enough)).toBe('insufficient');
    expect(compareMetric(5, 0, 'higher-is-better', enough)).toBe('insufficient');
  });
});

describe('formatDuration', () => {
  it('uses the unit a person would say', () => {
    expect(formatDuration(null)).toBe('n/a');
    expect(formatDuration(45)).toBe('45 seconds');
    expect(formatDuration(600)).toBe('10 minutes');
    expect(formatDuration(5400)).toBe('1.5 hours');
  });
});

describe('buildInsights', () => {
  it('produces no performance insight from an empty workspace, only notes about data it does not have', () => {
    const result = buildInsights(input({ coverage: { orders: false, leads: false, ai: false, sla: false, csat: false } }));
    expect(result.every((i) => i.severity === 'info' && i.area === 'data')).toBe(true);
  });

  it('flags customers waiting over an hour only at or above the threshold', () => {
    expect(ids(input({ backlog: { ...emptyBacklog, awaitingReply: 2, awaitingReplyOverHour: 2 } }))).not.toContain('awaiting-reply');
    const result = buildInsights(input({ backlog: { ...emptyBacklog, open: 9, awaitingReply: 4, awaitingReplyOverHour: 3, oldestWaitingSeconds: 7200 } }));
    const insight = result.find((i) => i.id === 'awaiting-reply');
    expect(insight?.severity).toBe('attention');
    expect(insight?.evidence.join(' ')).toContain('2.0 hours');
    expect(insight?.link?.href).toBe('/inbox');
  });

  it('reports a slower first reply only with enough samples and a meaningful absolute and relative change', () => {
    const slower = input({ current: kpis({ firstResponse: response(600, 40) }), previous: kpis({ firstResponse: response(300, 40) }) });
    expect(ids(slower)).toContain('first-response-slower');

    const thin = input({ current: kpis({ firstResponse: response(600, 4) }), previous: kpis({ firstResponse: response(300, 40) }) });
    expect(ids(thin)).not.toContain('first-response-slower');

    const tinyAbsolute = input({ current: kpis({ firstResponse: response(40, 40) }), previous: kpis({ firstResponse: response(20, 40) }) });
    expect(ids(tinyAbsolute)).not.toContain('first-response-slower');
  });

  it('describes a faster first reply as information, not a warning', () => {
    const faster = input({ current: kpis({ firstResponse: response(200, 40) }), previous: kpis({ firstResponse: response(600, 40) }) });
    expect(buildInsights(faster).find((i) => i.id === 'first-response-faster')?.severity).toBe('info');
  });

  it('flags a backlog that grows because conversations open faster than they resolve', () => {
    const growing = input({
      current: kpis({ conversations: { total: 100, newContact: 60, returningContact: 40 }, resolved: 50 }),
      backlog: { ...emptyBacklog, open: 70 },
    });
    expect(ids(growing)).toContain('backlog-growing');
    const keepingUp = input({ current: kpis({ conversations: { total: 100, newContact: 60, returningContact: 40 }, resolved: 95 }) });
    expect(ids(keepingUp)).not.toContain('backlog-growing');
  });

  it('treats a volume increase as information and a volume drop as something to check', () => {
    const base = (now: number) => input({
      current: kpis({ conversations: { total: now, newContact: now, returningContact: 0 } }),
      previous: kpis({ conversations: { total: 40, newContact: 40, returningContact: 0 } }),
    });
    expect(buildInsights(base(80)).find((i) => i.id === 'volume-up')?.severity).toBe('info');
    expect(buildInsights(base(20)).find((i) => i.id === 'volume-down')?.severity).toBe('attention');
    expect(ids(base(42))).not.toContain('volume-up');
  });

  it('does not report volume change from a baseline too small to mean anything', () => {
    const tiny = input({
      current: kpis({ conversations: { total: 8, newContact: 8, returningContact: 0 } }),
      previous: kpis({ conversations: { total: 2, newContact: 2, returningContact: 0 } }),
    });
    expect(ids(tiny)).not.toContain('volume-up');
  });

  it('names the busiest slots when demand is concentrated, and stays silent when it is spread out', () => {
    const concentrated = input({
      heatmap: [{ dayOfWeek: 1, hour: 9, count: 40 }, { dayOfWeek: 1, hour: 10, count: 30 }, { dayOfWeek: 2, hour: 9, count: 20 }, { dayOfWeek: 3, hour: 14, count: 10 }],
    });
    const peak = buildInsights(concentrated).find((i) => i.id === 'peak-hours');
    expect(peak?.evidence.some((e) => e.startsWith('Monday 09:00 to 10:00: 40'))).toBe(true);

    const spread = input({ heatmap: Array.from({ length: 24 }, (_, hour) => ({ dayOfWeek: 1, hour, count: 5 })) });
    expect(ids(spread)).not.toContain('peak-hours');
  });

  it('suggests a knowledge-base answer for a dominant topic', () => {
    const dominant = input({
      topics: [{ label: 'pricing', conversations: 30, previousConversations: 10, unresolved: 12 }],
      labelledConversations: 60,
    });
    const topic = buildInsights(dominant).find((i) => i.id === 'top-topic');
    expect(topic?.title).toContain('pricing');
    expect(topic?.evidence[0]).toContain('30 of 60');
    expect(ids(input({ topics: [{ label: 'x', conversations: 5, previousConversations: 0, unresolved: 0 }], labelledConversations: 10 }))).not.toContain('top-topic');
  });

  it('flags a rising AI hand-off rate and heavy rejection of suggestions', () => {
    const ai = (engaged: number, handed: number) => kpis({ ai: { ...kpis().ai, engagedConversations: engaged, handedToPerson: handed } });
    expect(ids(input({ current: ai(50, 25), previous: ai(50, 10) }))).toContain('ai-handoffs-up');
    expect(ids(input({ current: ai(50, 11), previous: ai(50, 10) }))).not.toContain('ai-handoffs-up');

    const rejecting = input({ current: kpis({ ai: { ...kpis().ai, suggestions: 30, suggestionsRejected: 15 } }) });
    expect(ids(rejecting)).toContain('ai-suggestions-rejected');
  });

  it('flags a satisfaction drop only with enough ratings in both periods', () => {
    const csat = (average: number, responses: number) => kpis({ csat: { average, responses } });
    expect(ids(input({ current: csat(3.9, 8), previous: csat(4.6, 9) }))).toContain('csat-down');
    expect(ids(input({ current: csat(3.9, 2), previous: csat(4.6, 9) }))).not.toContain('csat-down');
  });

  it('highlights a channel that produces most qualified leads, and says nothing when only one channel has leads', () => {
    const channel = (name: 'WHATSAPP' | 'INSTAGRAM', qualifiedLeads: number) =>
      ({ channel: name, conversations: 50, previousConversations: 40, qualifiedLeads, paidOrders: 0 });
    expect(ids(input({ channels: [channel('WHATSAPP', 4), channel('INSTAGRAM', 16)] }))).toContain('best-lead-channel');
    expect(ids(input({ channels: [channel('WHATSAPP', 20), { ...channel('INSTAGRAM', 0) }] }))).not.toContain('best-lead-channel');
  });

  it('explains missing revenue instead of estimating it', () => {
    const none = buildInsights(input({ coverage: { ...fullCoverage, orders: false } })).find((i) => i.id === 'no-orders');
    expect(none?.severity).toBe('info');
    expect(none?.why).toContain('never used to estimate money');
    expect(ids(input())).not.toContain('no-orders');
  });

  it('orders attention before opportunities before information', () => {
    const result = buildInsights(input({
      backlog: { ...emptyBacklog, awaitingReply: 5, awaitingReplyOverHour: 5, unassigned: 6, open: 12 },
      hotLeadsOpen: 3,
      coverage: { ...fullCoverage, orders: false },
    }));
    const rank = { attention: 0, opportunity: 1, info: 2 } as const;
    const ranks = result.map((r) => rank[r.severity]);
    expect([...ranks].sort()).toEqual(ranks);
    expect(result[0].severity).toBe('attention');
  });

  it('gives every insight the five parts a reader needs', () => {
    const result = buildInsights(input({
      backlog: { ...emptyBacklog, awaitingReply: 5, awaitingReplyOverHour: 5, unassigned: 6, open: 12, oldestWaitingSeconds: 5000 },
      hotLeadsOpen: 2, coverage: { ...fullCoverage, orders: false, csat: false },
    }));
    for (const i of result) {
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.why.length).toBeGreaterThan(0);
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.action.length).toBeGreaterThan(0);
    }
  });
});

describe('buildHealth', () => {
  const area = (h: ReturnType<typeof buildHealth>, key: string) => h.find((a) => a.key === key)!;

  it('reports insufficient data rather than a status when nothing can be compared', () => {
    const health = buildHealth({ current: kpis(), previous: kpis(), backlog: emptyBacklog });
    expect(health.every((a) => a.status === 'insufficient-data')).toBe(true);
  });

  it('marks team efficiency as improving when replies get faster and nothing else is wrong', () => {
    const health = buildHealth({
      current: kpis({ firstResponse: response(120, 30) }), previous: kpis({ firstResponse: response(400, 30) }), backlog: emptyBacklog,
    });
    expect(area(health, 'team').status).toBe('improving');
  });

  it('marks team efficiency as needing attention when replies get slower', () => {
    const health = buildHealth({
      current: kpis({ firstResponse: response(900, 30) }), previous: kpis({ firstResponse: response(400, 30) }), backlog: emptyBacklog,
    });
    expect(area(health, 'team').status).toBe('needs-attention');
  });

  it('lets a hard operational flag override an otherwise improving area, and says why', () => {
    const health = buildHealth({
      current: kpis({ firstResponse: response(120, 30) }), previous: kpis({ firstResponse: response(400, 30) }),
      backlog: { ...emptyBacklog, open: 9, unassigned: 7 },
    });
    const team = area(health, 'team');
    expect(team.status).toBe('needs-attention');
    expect(team.basis.join(' ')).toContain('7 open conversations have no owner');
  });

  it('explains every status with the rules that produced it', () => {
    const health = buildHealth({ current: kpis(), previous: kpis(), backlog: emptyBacklog });
    for (const a of health) expect(a.basis.length).toBeGreaterThan(0);
  });
});
