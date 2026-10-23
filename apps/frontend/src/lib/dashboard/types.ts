/** Response shapes of GET /dashboard/command/* (mirrors apps/backend/src/dashboard/dashboard-command.types.ts). */
import type { AgentRow, ChannelRow, Coverage, HealthArea, Insight } from '@/lib/analytics/types';

export type DashboardPreset = 'today' | '7d' | '30d' | 'custom';

export interface DashboardRange {
  preset: DashboardPreset;
  from: string;
  to: string;
}

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

export interface AttentionItem {
  kind: AttentionKind;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  title: string;
  detail: string;
  href: string;
  samples: Array<{ conversationId: string; contactName: string | null; ageSeconds: number }>;
}

export interface DashboardAttention {
  meta: DashboardMeta;
  items: AttentionItem[];
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

export interface DashboardActivity {
  meta: DashboardMeta;
  entries: Array<{
    id: string; kind: ActivityKind; at: string; conversationId: string; contactName: string | null; actorName: string | null;
  }>;
}

export interface DashboardRecommendations {
  meta: DashboardMeta;
  insights: Insight[];
  health: HealthArea[];
}
