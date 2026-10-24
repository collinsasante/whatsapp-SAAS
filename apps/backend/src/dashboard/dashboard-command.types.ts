/**
 * Response shapes for the owner dashboard (GET /dashboard/command/*). Each widget has its own endpoint so one slow
 * or failing query never blanks the page. A field is `null` when it cannot be computed, which is different from 0.
 */
import type { Coverage, ChannelRow, AgentRow, Insight, HealthArea } from '../analytics/analytics-intelligence.types';

export interface DashboardMeta {
  workspaceName: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  days: number;
  timezone: string;
  granularity: 'hour' | 'day';
  generatedAt: string;
}

export interface PeriodSummary {
  conversations: { total: number; newContact: number; returningContact: number };
  newCustomers: number;
  firstResponse: { samples: number; medianSeconds: number | null };
  /** Of the conversations opened in the period, how many are resolved now (including after the period ended). */
  resolution: { opened: number; resolved: number; rate: number | null };
  engagement: { inbound: number; outbound: number };
  leads: { created: number; qualified: number };
  orders: { byCurrency: Array<{ currency: string; paidOrders: number; revenue: number }> };
}

export interface DashboardSummary {
  meta: DashboardMeta;
  coverage: Coverage;
  current: PeriodSummary;
  previous: PeriodSummary;
}

export interface TrendPoint {
  /** `YYYY-MM-DD` for daily buckets, `YYYY-MM-DD HH` for hourly buckets (workspace timezone). */
  bucket: string;
  opened: number;
  resolved: number;
  inbound: number;
  outbound: number;
  newCustomers: number;
  returningCustomers: number;
}

export interface DashboardTrend {
  meta: DashboardMeta;
  points: TrendPoint[];
  channels: ChannelRow[];
}

export type AttentionKind =
  | 'requests' | 'unassigned' | 'awaiting_reply' | 'sla_breached' | 'failed_deliveries' | 'failed_campaigns' | 'channel_problems';

export interface AttentionConversation {
  conversationId: string;
  contactName: string | null;
  /** Seconds since the customer's last unanswered message, or since the delivery failed. */
  ageSeconds: number;
}

export interface AttentionItem {
  kind: AttentionKind;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  title: string;
  detail: string;
  /** In-app link to the filtered view that lists exactly these records. */
  href: string;
  samples: AttentionConversation[];
}

export interface DashboardAttention {
  meta: DashboardMeta;
  items: AttentionItem[];
  /** Which checks ran, so an empty list can be told apart from "not checked". */
  checked: AttentionKind[];
  notChecked: Array<{ kind: AttentionKind; reason: string }>;
}

export interface DashboardTeam {
  meta: DashboardMeta;
  agents: AgentRow[];
  workload: { open: number; unassigned: number };
}

export interface AiPeriod {
  engagedConversations: number;
  autoReplies: number;
  suggestions: number;
  suggestionsSent: number;
  handedToPerson: number;
  /** Resolved in the period, with an AI auto-reply and no outbound message from a person. */
  resolvedWithoutPerson: number;
  averageConfidence: number | null;
}

export interface DashboardAi {
  meta: DashboardMeta;
  coverage: Coverage;
  enabled: boolean;
  mode: 'SUGGESTION' | 'AUTO_REPLY' | null;
  credits: { balance: number; usedCurrent: number | null; usedPrevious: number | null };
  current: AiPeriod;
  previous: AiPeriod;
}

export type ActivityKind = 'requested' | 'intervened' | 'resolved' | 'reopened' | 'assigned' | 'unassigned' | 'transferred' | 'sla_breached';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  at: string;
  conversationId: string;
  contactName: string | null;
  actorName: string | null;
}

export interface DashboardActivity {
  meta: DashboardMeta;
  entries: ActivityEntry[];
}

export interface DashboardRecommendations {
  meta: DashboardMeta;
  insights: Insight[];
  health: HealthArea[];
}
