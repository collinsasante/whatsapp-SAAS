/** Response shapes of GET /dashboard/command/* (mirrors apps/backend/src/dashboard/dashboard-command.types.ts). */
import type { ChannelRow, Coverage } from '@/lib/analytics/types';

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

export interface DashboardRequests {
  meta: DashboardMeta;
  requesting: number;
  overdue: number;
  oldestWaitingSeconds: number | null;
  deadlineMinutes: number | null;
  samples: Array<{ conversationId: string; contactName: string | null; waitingSeconds: number; overdue: boolean }>;
}

export interface DashboardBusiness {
  meta: DashboardMeta;
  business: {
    name: string; phone: string | null; email: string | null; address: string | null; website: string | null;
    description: string | null; category: string | null; logoUrl: string | null;
  };
  missing: Array<'phone' | 'email' | 'address' | 'website' | 'description'>;
  account: {
    plan: string; subscriptionStatus: string | null; billingCycle: string | null; trialEndsAt: string | null;
    currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; createdAt: string; timezone: string;
    members: number; channels: number; aiCreditsBalance: number; billingEmail: string | null;
  };
}

export type MetaCheckError = 'TOKEN_INVALID' | 'META_ERROR' | 'UNREACHABLE';

export interface WhatsAppNumberStatus {
  id: string;
  label: string;
  isDefault: boolean;
  live: {
    displayPhone: string | null; verifiedName: string | null; quality: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    messagingLimit: string | null; numberStatus: string | null; nameStatus: string | null; verification: string | null;
  } | null;
  error: { kind: MetaCheckError; message: string } | null;
  lastKnown: { quality: string | null; messagingLimit: string | null; syncedAt: string | null } | null;
  lastError: string | null;
}

export interface DashboardWhatsAppStatus {
  meta: DashboardMeta;
  checkedAt: string;
  connected: boolean;
  numbers: WhatsAppNumberStatus[];
  qrSessions: Array<{ id: string; phoneNumber: string | null; status: string; lastSeenAt: string | null; lastError: string | null }>;
}
