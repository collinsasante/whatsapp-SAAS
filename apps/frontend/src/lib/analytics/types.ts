/** Mirrors apps/backend/src/analytics/analytics-intelligence.types.ts (the response of GET /analytics/intelligence). */

export type ChannelFilter = 'ALL' | 'WHATSAPP' | 'FACEBOOK_MESSENGER' | 'INSTAGRAM';
export type MessagingChannel = Exclude<ChannelFilter, 'ALL'>;

export interface DurationStats {
  samples: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  meanSeconds: number | null;
}

export interface FirstResponseStats extends DurationStats {
  buckets: Array<{ key: string; label: string; count: number }>;
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
  orders: { byCurrency: OrderRevenue[]; refunded: number; conversationsWithPaidOrder: number };
  ai: {
    engagedConversations: number;
    autoReplies: number;
    suggestions: number;
    suggestionsSent: number;
    suggestionsEdited: number;
    suggestionsRejected: number;
    averageConfidence: number | null;
    handedToPerson: number;
    resolvedWithoutPerson: number;
    creditsUsed: number | null;
  };
}

export interface SeriesPoint {
  date: string;
  opened: number;
  resolved: number;
  newContacts: number;
  inbound: number;
  previousOpened: number;
}

export interface ChannelRow {
  channel: MessagingChannel;
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
    channel: MessagingChannel;
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
  title: string;
  why: string;
  evidence: string[];
  action: string;
  link?: { href: string; label: string };
  priority: number;
}

export type HealthStatus = 'improving' | 'stable' | 'needs-attention' | 'insufficient-data';

export interface HealthArea {
  key: 'communication' | 'team' | 'customers' | 'ai' | 'growth';
  label: string;
  status: HealthStatus;
  basis: string[];
}

export interface Coverage {
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

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
