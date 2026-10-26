/**
 * Response shapes for the owner dashboard (GET /dashboard/command/*). Each widget has its own endpoint so one slow
 * or failing query never blanks the page. A field is `null` when it cannot be computed, which is different from 0.
 */
import type { Coverage, ChannelRow } from '../analytics/analytics-intelligence.types';

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
  | 'unassigned' | 'awaiting_reply' | 'sla_breached' | 'failed_deliveries' | 'failed_campaigns' | 'channel_problems';

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

export interface DashboardRequests {
  meta: DashboardMeta;
  /** Conversations waiting for a person right now (status Requesting). Not bound to the date range. */
  requesting: number;
  /** Of those, how many are past the reply deadline. */
  overdue: number;
  oldestWaitingSeconds: number | null;
  /** Minutes allowed before a request is overdue; null when the deadline is turned off. */
  deadlineMinutes: number | null;
  samples: Array<{ conversationId: string; contactName: string | null; waitingSeconds: number; overdue: boolean }>;
}

export interface DashboardBusiness {
  meta: DashboardMeta;
  business: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    website: string | null;
    description: string | null;
    category: string | null;
    logoUrl: string | null;
  };
  /** Business details nobody has filled in yet, so the card can say so instead of showing blanks. */
  missing: Array<'phone' | 'email' | 'address' | 'website' | 'description'>;
  account: {
    plan: string;
    subscriptionStatus: string | null;
    billingCycle: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    timezone: string;
    members: number;
    channels: number;
    aiCreditsBalance: number;
    billingEmail: string | null;
  };
}

export type MetaCheckError = 'TOKEN_INVALID' | 'META_ERROR' | 'UNREACHABLE';

export interface WhatsAppNumberStatus {
  id: string;
  label: string;
  isDefault: boolean;
  /** Read from Meta just now (or within the last minute); null when Meta could not be reached. */
  live: {
    displayPhone: string | null;
    verifiedName: string | null;
    quality: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    messagingLimit: string | null;
    numberStatus: string | null;
    nameStatus: string | null;
    verification: string | null;
  } | null;
  error: { kind: MetaCheckError; message: string } | null;
  /** The last values VerzChat stored from Meta, shown only when the live check failed. */
  lastKnown: { quality: string | null; messagingLimit: string | null; syncedAt: string | null } | null;
  lastError: string | null;
}

export interface DashboardWhatsAppStatus {
  meta: DashboardMeta;
  checkedAt: string;
  connected: boolean;
  numbers: WhatsAppNumberStatus[];
  /** Phones linked by QR code. These are not Meta's official API; the state is what VerzChat last recorded. */
  qrSessions: Array<{ id: string; phoneNumber: string | null; status: string; lastSeenAt: string | null; lastError: string | null }>;
}
