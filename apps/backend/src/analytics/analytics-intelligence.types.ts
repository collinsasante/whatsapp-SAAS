/**
 * Response shapes for GET /analytics/intelligence.
 *
 * Every number here is computed from tenant data by SQL aggregation. A field is `null` when the metric cannot be
 * computed (no samples, or the tenant has never produced the underlying records), which is different from 0.
 */

export type ChannelFilter = 'ALL' | 'WHATSAPP' | 'FACEBOOK_MESSENGER' | 'INSTAGRAM';

/** Channel groups used throughout analytics. WhatsApp Cloud API and WhatsApp QR sessions are both "WhatsApp". */
export const CHANNEL_GROUP_TYPES: Record<Exclude<ChannelFilter, 'ALL'>, string[]> = {
  WHATSAPP: ['WHATSAPP', 'WHATSAPP_WEB'],
  FACEBOOK_MESSENGER: ['FACEBOOK_MESSENGER'],
  INSTAGRAM: ['INSTAGRAM'],
};

export interface DurationStats {
  samples: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  meanSeconds: number | null;
}

export interface FirstResponseStats extends DurationStats {
  /** Share of conversations first answered within each window; counts sum to `samples`. */
  buckets: Array<{ key: 'under5m' | 'under15m' | 'under1h' | 'under4h' | 'over4h'; label: string; count: number }>;
  /** Same measure but only counting a reply written by a person (not Verz AI). */
  human: DurationStats;
}

export interface OrderRevenue {
  currency: string;
  paidOrders: number;
  revenue: number;
}

export interface PeriodKpis {
  conversations: { total: number; newContact: number; returningContact: number };
  resolved: number;
  reopened: number;
  newContacts: number;
  activeContacts: number;
  inboundMessages: number;
  firstResponse: FirstResponseStats;
  resolution: DurationStats;
  sla: { tracked: number; breached: number };
  csat: { responses: number; average: number | null };
  leads: { created: number; qualified: number; converted: number };
  orders: {
    byCurrency: OrderRevenue[];
    refunded: number;
    /** Conversations opened in the period that have at least one paid order (any time). */
    conversationsWithPaidOrder: number;
  };
  ai: {
    /** Conversations with at least one Verz AI suggestion or auto-reply logged in the period. */
    engagedConversations: number;
    autoReplies: number;
    suggestions: number;
    suggestionsSent: number;
    suggestionsEdited: number;
    suggestionsRejected: number;
    averageConfidence: number | null;
    /** AI-engaged conversations that were escalated to a person or taken over by an agent in the period. */
    handedToPerson: number;
    /** Resolved in the period, had an AI auto-reply, and no outbound message from a person. */
    resolvedWithoutPerson: number;
    /** Null when a channel filter is applied: credits are billed per workspace, not per channel. */
    creditsUsed: number | null;
  };
}

export interface SeriesPoint {
  date: string;
  opened: number;
  resolved: number;
  newContacts: number;
  inbound: number;
  /** Conversations opened on the matching day of the previous period, for the comparison overlay. */
  previousOpened: number;
}

export interface ChannelRow {
  channel: Exclude<ChannelFilter, 'ALL'>;
  conversations: number;
  previousConversations: number;
  qualifiedLeads: number;
  paidOrders: number;
}

export interface TopicRow {
  label: string;
  conversations: number;
  previousConversations: number;
  unresolved: number;
}

export interface BacklogSnapshot {
  open: number;
  unassigned: number;
  slaBreached: number;
  awaitingReply: number;
  awaitingReplyOverHour: number;
  oldestWaitingSeconds: number | null;
  waiting: Array<{
    conversationId: string;
    contactName: string | null;
    channel: Exclude<ChannelFilter, 'ALL'>;
    waitingSeconds: number;
    assignedTo: string | null;
  }>;
}

export interface AgentRow {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  assigned: number;
  resolved: number;
  openNow: number;
  reopened: number;
  firstResponse: DurationStats;
  resolution: DurationStats;
  csat: { responses: number; average: number | null };
}

export type InsightSeverity = 'attention' | 'opportunity' | 'info';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  area: 'conversations' | 'team' | 'ai' | 'customers' | 'growth' | 'data';
  /** What happened. */
  title: string;
  /** Why it matters. */
  why: string;
  /** The numbers behind the statement. */
  evidence: string[];
  /** What to do next. */
  action: string;
  link?: { href: string; label: string };
  priority: number;
}

export type HealthStatus = 'improving' | 'stable' | 'needs-attention' | 'insufficient-data';

export interface HealthArea {
  key: 'communication' | 'team' | 'customers' | 'ai' | 'growth';
  label: string;
  status: HealthStatus;
  /** One line per rule that decided the status, so the status is explainable. */
  basis: string[];
}

export interface Coverage {
  /** True once the workspace has ever recorded the underlying records, so zeros can be told apart from "not tracked". */
  orders: boolean;
  leads: boolean;
  ai: boolean;
  sla: boolean;
  csat: boolean;
}

export interface IntelligenceResponse {
  meta: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    days: number;
    timezone: string;
    channel: ChannelFilter;
    generatedAt: string;
  };
  coverage: Coverage;
  current: PeriodKpis;
  previous: PeriodKpis;
  series: SeriesPoint[];
  heatmap: Array<{ dayOfWeek: number; hour: number; count: number }>;
  channels: ChannelRow[];
  sources: Array<{ source: string; conversations: number }>;
  topics: { rows: TopicRow[]; labelledConversations: number; totalConversations: number };
  productInterest: Array<{ product: string; leads: number }>;
  leadStatuses: Array<{ status: string; count: number }>;
  backlog: BacklogSnapshot;
  agents: AgentRow[];
  insights: Insight[];
  health: HealthArea[];
}
