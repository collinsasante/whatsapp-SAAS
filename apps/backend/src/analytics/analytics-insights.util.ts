import {
  BacklogSnapshot, ChannelRow, Coverage, HealthArea, HealthStatus, Insight, PeriodKpis, TopicRow,
} from './analytics-intelligence.types';

/**
 * Rules-based insights and health statuses. Pure functions of already-aggregated numbers: nothing here reads the
 * database or calls a model, so every statement can be traced to the values in its `evidence` list and tested.
 *
 * Two safeguards apply to every rule:
 *  - a minimum sample size, so a change from 2 to 3 conversations is never reported as growth;
 *  - a minimum relative and absolute change, so noise is not reported as a trend.
 */

export const THRESHOLDS = {
  minSamples: 10,
  /** Relative change that counts as a real movement for volume and time metrics. */
  changeRatio: 0.25,
  /** Health statuses treat anything within this band as stable. */
  stableBand: 0.1,
  minResponseChangeSeconds: 60,
  awaitingOverHourAttention: 3,
  unassignedAttention: 5,
  slaBreachRate: 0.1,
  topTopicShare: 0.25,
  topTopicMin: 10,
  peakMinInbound: 50,
  peakShare: 0.4,
  aiRejectRate: 0.4,
  aiMinSuggestions: 20,
  handoffRiseRatio: 0.1,
  csatDrop: 0.5,
  csatMinResponses: 5,
} as const;

export interface InsightInput {
  current: PeriodKpis;
  previous: PeriodKpis;
  backlog: BacklogSnapshot;
  heatmap: Array<{ dayOfWeek: number; hour: number; count: number }>;
  topics: TopicRow[];
  labelledConversations: number;
  channels: ChannelRow[];
  coverage: Coverage;
  hotLeadsOpen: number;
  days: number;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'n/a';
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

function hourLabel(hour: number): string {
  const next = (hour + 1) % 24;
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${fmt(hour)} to ${fmt(next)}`;
}

/** Relative change, or null when the baseline is zero (growth from nothing has no percentage). */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function pct(ratio: number): string {
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

export function buildInsights(input: InsightInput): Insight[] {
  const { current, previous, backlog, heatmap, topics, channels, coverage } = input;
  const out: Insight[] = [];

  // 1. Customers waiting for a reply right now.
  if (backlog.awaitingReplyOverHour >= THRESHOLDS.awaitingOverHourAttention) {
    out.push({
      id: 'awaiting-reply',
      severity: 'attention',
      area: 'conversations',
      title: `${backlog.awaitingReplyOverHour} customers have been waiting more than an hour for a reply`,
      why: 'The longer a customer waits on a messaging channel, the less likely they are to still be interested when you answer.',
      evidence: [
        `${backlog.awaitingReply} open conversations are waiting on your reply, ${backlog.awaitingReplyOverHour} of them for over an hour`,
        `The longest wait is ${formatDuration(backlog.oldestWaitingSeconds)}`,
      ],
      action: 'Answer the oldest conversations first, or assign them so each one has an owner.',
      link: { href: '/inbox', label: 'Open the inbox' },
      priority: 100,
    });
  }

  // 2. Unassigned open conversations.
  if (backlog.unassigned >= THRESHOLDS.unassignedAttention) {
    out.push({
      id: 'unassigned',
      severity: 'attention',
      area: 'team',
      title: `${backlog.unassigned} open conversations have no owner`,
      why: 'A conversation nobody owns is the one most likely to be missed.',
      evidence: [`${backlog.unassigned} of ${backlog.open} open conversations are unassigned`],
      action: 'Assign them, or turn on an automation that assigns new conversations.',
      link: { href: '/inbox', label: 'Open the inbox' },
      priority: 90,
    });
  }

  // 3. First reply got slower.
  const frNow = current.firstResponse;
  const frBefore = previous.firstResponse;
  if (
    frNow.samples >= THRESHOLDS.minSamples && frBefore.samples >= THRESHOLDS.minSamples &&
    frNow.medianSeconds != null && frBefore.medianSeconds != null
  ) {
    const change = relativeChange(frNow.medianSeconds, frBefore.medianSeconds);
    const delta = frNow.medianSeconds - frBefore.medianSeconds;
    if (change != null && change >= THRESHOLDS.changeRatio && delta >= THRESHOLDS.minResponseChangeSeconds) {
      out.push({
        id: 'first-response-slower',
        severity: 'attention',
        area: 'team',
        title: 'Customers are waiting longer for a first reply',
        why: 'First-reply time is the part of the experience customers notice most, and it usually reflects coverage at busy times.',
        evidence: [
          `Median first reply: ${formatDuration(frNow.medianSeconds)}, up from ${formatDuration(frBefore.medianSeconds)} (${pct(change)} slower)`,
          `Based on ${frNow.samples} conversations now and ${frBefore.samples} in the previous period`,
        ],
        action: 'Compare your busiest hours with who is online, and consider letting Verz AI answer first outside staffed hours.',
        link: { href: '/ai', label: 'Review Verz AI settings' },
        priority: 80,
      });
    } else if (change != null && change <= -THRESHOLDS.changeRatio && -delta >= THRESHOLDS.minResponseChangeSeconds) {
      out.push({
        id: 'first-response-faster',
        severity: 'info',
        area: 'team',
        title: 'First replies are getting faster',
        why: 'Faster first replies are associated with better customer experience.',
        evidence: [`Median first reply: ${formatDuration(frNow.medianSeconds)}, down from ${formatDuration(frBefore.medianSeconds)}`],
        action: 'Keep the current coverage pattern, and check that quality holds as speed improves.',
        priority: 20,
      });
    }
  }

  // 4. Resolution is not keeping up with new conversations.
  if (current.conversations.total >= THRESHOLDS.minSamples) {
    const gap = current.conversations.total - current.resolved;
    if (gap >= THRESHOLDS.minSamples && current.resolved < current.conversations.total * (1 - THRESHOLDS.changeRatio)) {
      out.push({
        id: 'backlog-growing',
        severity: 'attention',
        area: 'conversations',
        title: 'Conversations are being opened faster than they are resolved',
        why: 'When resolutions trail new conversations, the open queue grows and waiting times follow.',
        evidence: [
          `${current.conversations.total} conversations opened, ${current.resolved} resolved in the same period`,
          `${backlog.open} conversations are open now`,
        ],
        action: 'Resolve finished conversations so the queue reflects real work, and check whether more coverage is needed at peak hours.',
        link: { href: '/inbox', label: 'Open the inbox' },
        priority: 70,
      });
    }
  }

  // 5. Volume change.
  if (previous.conversations.total >= THRESHOLDS.minSamples) {
    const change = relativeChange(current.conversations.total, previous.conversations.total);
    if (change != null && Math.abs(change) >= THRESHOLDS.changeRatio) {
      const up = change > 0;
      out.push({
        id: up ? 'volume-up' : 'volume-down',
        severity: up ? 'info' : 'attention',
        area: 'conversations',
        title: up ? 'Conversation volume rose compared with the previous period' : 'Conversation volume fell compared with the previous period',
        why: up
          ? 'More conversations means more demand, and more load on the team.'
          : 'Fewer conversations can mean fewer customers reaching you, or a channel that has stopped delivering messages.',
        evidence: [`${current.conversations.total} conversations, ${up ? 'up' : 'down'} ${pct(change)} from ${previous.conversations.total}`],
        action: up
          ? 'Check that response times held up while volume grew.'
          : 'Confirm your channels are still connected, and check where recent customers came from.',
        link: up ? undefined : { href: '/channels', label: 'Check channels' },
        priority: up ? 30 : 60,
      });
    }
  }

  // 6. Peak workload.
  const inboundTotal = heatmap.reduce((s, c) => s + c.count, 0);
  if (inboundTotal >= THRESHOLDS.peakMinInbound) {
    const slots = [...heatmap].sort((a, b) => b.count - a.count).slice(0, 3);
    const share = slots.reduce((s, c) => s + c.count, 0) / inboundTotal;
    if (share >= THRESHOLDS.peakShare) {
      out.push({
        id: 'peak-hours',
        severity: 'opportunity',
        area: 'team',
        title: 'Customer messages are concentrated in a few hours of the week',
        why: 'Concentrated demand is the easiest thing to plan staffing around.',
        evidence: [
          `The three busiest slots hold ${pct(share)} of ${inboundTotal} customer messages`,
          ...slots.map((s) => `${DOW[s.dayOfWeek]} ${hourLabel(s.hour)}: ${s.count} messages`),
        ],
        action: 'Make sure agents are online in these slots, or let Verz AI answer first during them.',
        priority: 50,
      });
    }
  }

  // 7. A topic that dominates the conversations.
  if (input.labelledConversations >= THRESHOLDS.topTopicMin && topics.length > 0) {
    const top = topics[0];
    const share = top.conversations / input.labelledConversations;
    if (top.conversations >= THRESHOLDS.topTopicMin && share >= THRESHOLDS.topTopicShare) {
      out.push({
        id: 'top-topic',
        severity: 'opportunity',
        area: 'conversations',
        title: `"${top.label}" is the most common conversation label`,
        why: 'A repeated subject is a candidate for a saved reply, a knowledge-base article or an automation, which removes the repeated typing.',
        evidence: [
          `${top.conversations} of ${input.labelledConversations} labelled conversations (${pct(share)}) carry this label`,
          `${top.unresolved} of them are still unresolved`,
        ],
        action: 'Write a knowledge-base answer for it so Verz AI can reply, or add an automation for it.',
        link: { href: '/ai', label: 'Open the knowledge base' },
        priority: 45,
      });
    }
  }

  // 8. SLA compliance.
  if (current.sla.tracked >= THRESHOLDS.minSamples) {
    const rate = current.sla.breached / current.sla.tracked;
    if (rate >= THRESHOLDS.slaBreachRate) {
      out.push({
        id: 'sla-breaches',
        severity: 'attention',
        area: 'team',
        title: `${pct(rate)} of conversations with a response target missed it`,
        why: 'These are conversations where a deadline was set and was passed.',
        evidence: [`${current.sla.breached} of ${current.sla.tracked} conversations breached their deadline`],
        action: 'Review which conversations breach most often, and whether the deadline matches your staffing.',
        link: { href: '/inbox', label: 'Open the inbox' },
        priority: 75,
      });
    }
  }

  // 9. AI handoffs and suggestion quality.
  if (current.ai.engagedConversations >= THRESHOLDS.minSamples && previous.ai.engagedConversations >= THRESHOLDS.minSamples) {
    const now = current.ai.handedToPerson / current.ai.engagedConversations;
    const before = previous.ai.handedToPerson / previous.ai.engagedConversations;
    if (now - before >= THRESHOLDS.handoffRiseRatio) {
      out.push({
        id: 'ai-handoffs-up',
        severity: 'attention',
        area: 'ai',
        title: 'More conversations are being passed from Verz AI to a person',
        why: 'A rising handoff rate usually means customers are asking things the knowledge base does not cover.',
        evidence: [
          `${pct(now)} of AI conversations needed a person, up from ${pct(before)}`,
          `${current.ai.handedToPerson} of ${current.ai.engagedConversations} conversations`,
        ],
        action: 'Read recent handed-off conversations and add the missing answers to the knowledge base.',
        link: { href: '/ai', label: 'Open the knowledge base' },
        priority: 65,
      });
    }
  }
  if (current.ai.suggestions >= THRESHOLDS.aiMinSuggestions) {
    const rejected = current.ai.suggestionsRejected / current.ai.suggestions;
    if (rejected >= THRESHOLDS.aiRejectRate) {
      out.push({
        id: 'ai-suggestions-rejected',
        severity: 'attention',
        area: 'ai',
        title: 'Agents are rejecting many Verz AI suggestions',
        why: 'Suggestions that are rejected cost agent time instead of saving it.',
        evidence: [`${current.ai.suggestionsRejected} of ${current.ai.suggestions} suggestions were rejected (${pct(rejected)})`],
        action: 'Review the knowledge base and the AI instructions for the topics that get rejected.',
        link: { href: '/ai', label: 'Open Verz AI' },
        priority: 55,
      });
    }
  }

  // 10. Customer satisfaction.
  if (
    current.csat.responses >= THRESHOLDS.csatMinResponses && previous.csat.responses >= THRESHOLDS.csatMinResponses &&
    current.csat.average != null && previous.csat.average != null &&
    previous.csat.average - current.csat.average >= THRESHOLDS.csatDrop
  ) {
    out.push({
      id: 'csat-down',
      severity: 'attention',
      area: 'team',
      title: 'Customer satisfaction scores dropped',
      why: 'Ratings come directly from customers after a conversation is resolved.',
      evidence: [`Average rating ${current.csat.average} out of 5, down from ${previous.csat.average}`, `${current.csat.responses} ratings this period`],
      action: 'Read the lowest-rated conversations to find the pattern.',
      priority: 62,
    });
  }

  // 11. Channels that produce more qualified leads.
  const withLeads = channels.filter((c) => c.qualifiedLeads > 0);
  const totalQualified = withLeads.reduce((s, c) => s + c.qualifiedLeads, 0);
  if (withLeads.length >= 2 && totalQualified >= THRESHOLDS.minSamples) {
    const best = [...withLeads].sort((a, b) => b.qualifiedLeads - a.qualifiedLeads)[0];
    const share = best.qualifiedLeads / totalQualified;
    if (share >= 0.6) {
      out.push({
        id: 'best-lead-channel',
        severity: 'opportunity',
        area: 'growth',
        title: `${channelName(best.channel)} produces most of your qualified leads`,
        why: 'Knowing which channel brings qualified conversations tells you where to put your effort.',
        evidence: [`${best.qualifiedLeads} of ${totalQualified} qualified leads (${pct(share)}) came from ${channelName(best.channel)}`],
        action: 'Make sure this channel is staffed first, and promote it in your marketing.',
        priority: 40,
      });
    }
  }

  // 12. Hot leads that have not been followed up.
  if (input.hotLeadsOpen > 0) {
    out.push({
      id: 'hot-leads',
      severity: 'opportunity',
      area: 'growth',
      title: `${input.hotLeadsOpen} leads are marked hot and have not converted yet`,
      why: 'Hot leads are the conversations where the customer showed the strongest buying signals.',
      evidence: [`${input.hotLeadsOpen} leads with status Hot`],
      action: 'Follow up with each one while the interest is fresh.',
      link: { href: '/contacts', label: 'Open contacts' },
      priority: 58,
    });
  }

  // 13. Data the workspace is not recording, so the page is honest about what it cannot show.
  if (!coverage.orders) {
    out.push({
      id: 'no-orders',
      severity: 'info',
      area: 'data',
      title: 'Sales and revenue are not shown because no orders are recorded',
      why: 'VerzChat can only report revenue from orders created through Commerce. Message counts are never used to estimate money.',
      evidence: ['No orders have been recorded in this workspace'],
      action: 'Use Commerce to create orders from conversations if you want revenue and conversion reporting here.',
      link: { href: '/commerce', label: 'Open Commerce' },
      priority: 5,
    });
  }
  if (!coverage.csat) {
    out.push({
      id: 'no-csat',
      severity: 'info',
      area: 'data',
      title: 'Customer satisfaction is not shown because no ratings have been collected',
      why: 'Satisfaction is only reported from ratings customers submit after a conversation.',
      evidence: ['No ratings have been recorded in this workspace'],
      action: 'Turn on satisfaction ratings in settings to start collecting them.',
      link: { href: '/settings', label: 'Open settings' },
      priority: 4,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

function channelName(channel: ChannelRow['channel']): string {
  return channel === 'FACEBOOK_MESSENGER' ? 'Messenger' : channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp';
}

// ─── Health ──────────────────────────────────────────────────────────────────

type Direction = 'higher-is-better' | 'lower-is-better';
type Verdict = 'better' | 'same' | 'worse' | 'insufficient';

/** Compares two period values. `minSamples` applies to both periods so a thin period cannot decide a status. */
export function compareMetric(
  current: number | null, previous: number | null, direction: Direction,
  samples: { current: number; previous: number }, minSamples: number = THRESHOLDS.minSamples,
): Verdict {
  if (current == null || previous == null) return 'insufficient';
  if (samples.current < minSamples || samples.previous < minSamples) return 'insufficient';
  const change = relativeChange(current, previous);
  if (change == null) return current === 0 ? 'same' : 'insufficient';
  if (Math.abs(change) <= THRESHOLDS.stableBand) return 'same';
  const up = change > 0;
  return (direction === 'higher-is-better') === up ? 'better' : 'worse';
}

function decide(rules: Array<{ text: string; verdict: Verdict }>, extraAttention: string[] = []): { status: HealthStatus; basis: string[] } {
  const basis = rules.map((r) => `${r.text}: ${labelVerdict(r.verdict)}`).concat(extraAttention);
  const usable = rules.filter((r) => r.verdict !== 'insufficient');
  if (extraAttention.length > 0 || usable.some((r) => r.verdict === 'worse')) return { status: 'needs-attention', basis };
  if (usable.length === 0) return { status: 'insufficient-data', basis };
  if (usable.some((r) => r.verdict === 'better')) return { status: 'improving', basis };
  return { status: 'stable', basis };
}

function labelVerdict(v: Verdict): string {
  return v === 'better' ? 'improved' : v === 'worse' ? 'worse' : v === 'same' ? 'within 10% of the previous period' : 'not enough data to compare';
}

export function buildHealth(input: Pick<InsightInput, 'current' | 'previous' | 'backlog'>): HealthArea[] {
  const { current: c, previous: p, backlog } = input;
  const counts = (cur: number, prev: number) => ({ current: cur, previous: prev });

  const communication = decide([
    {
      text: 'Conversations resolved',
      verdict: compareMetric(c.resolved, p.resolved, 'higher-is-better', counts(c.conversations.total, p.conversations.total)),
    },
  ], backlog.awaitingReplyOverHour >= THRESHOLDS.awaitingOverHourAttention
    ? [`${backlog.awaitingReplyOverHour} customers have waited over an hour for a reply`] : []);

  const team = decide([
    {
      text: 'Median first reply time',
      verdict: compareMetric(c.firstResponse.medianSeconds, p.firstResponse.medianSeconds, 'lower-is-better',
        counts(c.firstResponse.samples, p.firstResponse.samples)),
    },
    {
      text: 'Median resolution time',
      verdict: compareMetric(c.resolution.medianSeconds, p.resolution.medianSeconds, 'lower-is-better',
        counts(c.resolution.samples, p.resolution.samples)),
    },
  ], backlog.unassigned >= THRESHOLDS.unassignedAttention ? [`${backlog.unassigned} open conversations have no owner`] : []);

  const customers = decide([
    {
      text: 'Customers who messaged you',
      verdict: compareMetric(c.activeContacts, p.activeContacts, 'higher-is-better', counts(c.activeContacts, p.activeContacts)),
    },
    {
      text: 'Customer satisfaction',
      verdict: compareMetric(c.csat.average, p.csat.average, 'higher-is-better', counts(c.csat.responses, p.csat.responses), THRESHOLDS.csatMinResponses),
    },
  ]);

  const aiRate = (k: PeriodKpis) => (k.ai.engagedConversations > 0 ? k.ai.handedToPerson / k.ai.engagedConversations : null);
  const ai = decide([
    {
      text: 'Share of AI conversations passed to a person',
      verdict: compareMetric(aiRate(c), aiRate(p), 'lower-is-better', counts(c.ai.engagedConversations, p.ai.engagedConversations)),
    },
  ]);

  const growth = decide([
    {
      text: 'New contacts',
      verdict: compareMetric(c.newContacts, p.newContacts, 'higher-is-better', counts(c.newContacts, p.newContacts)),
    },
    {
      text: 'Leads created',
      verdict: compareMetric(c.leads.created, p.leads.created, 'higher-is-better', counts(c.leads.created, p.leads.created)),
    },
  ]);

  return [
    { key: 'communication', label: 'Customer communication', ...communication },
    { key: 'team', label: 'Team efficiency', ...team },
    { key: 'customers', label: 'Customer engagement', ...customers },
    { key: 'ai', label: 'Verz AI operations', ...ai },
    { key: 'growth', label: 'Growth', ...growth },
  ];
}

/** Buckets for first-reply time, shared with the SQL so the labels and cut-offs cannot drift apart. */
export const FIRST_RESPONSE_BUCKETS = [
  { key: 'under5m', label: 'Under 5 minutes', maxSeconds: 300 },
  { key: 'under15m', label: '5 to 15 minutes', maxSeconds: 900 },
  { key: 'under1h', label: '15 minutes to 1 hour', maxSeconds: 3600 },
  { key: 'under4h', label: '1 to 4 hours', maxSeconds: 14400 },
  { key: 'over4h', label: 'Over 4 hours', maxSeconds: Infinity },
] as const;
