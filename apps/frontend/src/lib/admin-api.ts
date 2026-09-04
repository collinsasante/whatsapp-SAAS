const BASE = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1') + '/platform-admin';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('admin_token') ?? '';
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // A 401 only means "your session expired" if we actually sent a token that got
  // rejected. A 401 on an unauthenticated call (login, forgot-password) just means
  // "invalid credentials" -- treating it as a session expiry wiped out that real
  // error message and silently bounced the user back to the login page they were
  // already on, which looked like a broken redirect loop.
  if (res.status === 401 && token) {
    localStorage.removeItem('admin_token');
    window.location.href = '/platform-admin/login';
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => ({ message: 'Request failed' }));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? 'Request failed');
  }
  return data as T;
}

export interface AdminStats {
  totalTenants: number;
  activeSubs: number;
  trialSubs: number;
  totalUsers: number;
  totalMessages: number;
  pendingInvoices: number;
  pendingCredits: number;
  monthlyRevenue: number;
}

export interface Workspace {
  id: string;
  name: string;
  isActive: boolean;
  billingEmail: string | null;
  createdAt: string;
  aiCredits: number;
  _count: { users: number; conversations: number };
  subscription: {
    status: string;
    cycle: string;
    currentPeriodEnd: string;
    plan: { name: string; monthlyPrice: number };
  } | null;
}

export interface TenantTableRow {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  createdAt: string;
  country: string | null;
  billingEmail: string | null;
  plan: string | null;
  trialEndsAt: string | null;
  mrrGhs: number;
  teammateCount: number;
  lastPayment: { status: string; gateway: string; createdAt: string } | null;
  healthScore: number;
  healthBreakdown: { loginActivity: number; messageActivity: number; broadcastActivity: number; teamSize: number; paymentStatus: number };
  churnRisk: boolean;
  usage: { conversationsThisMonth: number; messagesLast30Days: number; broadcastsThisMonth: number };
}

export interface WorkspaceDetail {
  id: string; name: string; isActive: boolean; billingEmail: string | null; createdAt: string;
  country: string | null; aiCredits: number;
  _count: { users: number; conversations: number; messages: number; contacts: number };
  subscription: {
    status: string; cycle: string; trialEndsAt: string | null; currentPeriodEnd: string;
    plan: { name: string; monthlyPrice: number; yearlyPrice: number; currency: string };
  } | null;
  whatsappNumbers: { id: string; label: string | null; phoneNumberId: string; qualityRating: string | null; messagingLimitTier: string | null; qualitySyncedAt: string | null }[];
  users: { id: string; name: string; email: string; role: string; lastLoginAt: string | null }[];
  invoices: Invoice[];
  creditPurchases: CreditPurchase[];
  payments: { id: string; gateway: string; status: string; amount: number; currency: string; createdAt: string; verifiedAt: string | null; failReason: string | null }[];
  auditLog: { id: string; action: string; resourceType: string | null; resourceId: string | null; metadata: unknown; createdAt: string; admin: { name: string; email: string } | null }[];
  usage: {
    messageTrend: { date: string; sent: number; received: number }[];
    conversationTrend: { date: string; opened: number; resolved: number }[];
  };
  recentCampaigns: { id: string; name: string; status: string; totalRecipients: number; sentCount: number; createdAt: string }[];
  healthScore: number;
  healthBreakdown: { loginActivity: number; messageActivity: number; broadcastActivity: number; teamSize: number; paymentStatus: number };
  churnRisk: boolean;
  lifecycleStage: string;
  settings: { commerceEnabled: boolean; takeRatePct: number | null } | null;
}

export interface RevenueData {
  period: { from: string; to: string };
  revenueByProviderDay: (Record<string, number> & { date: string })[];
  successRateByProvider: { gateway: string; successCount: number; failedCount: number; amountGhs: number; successRatePct: number | null }[];
  alerts: { gateway: string; successRatePct: number; sampleSize: number }[];
  failureReasons: { gateway: string; reason: string; count: number }[];
  pastDueWorklist: { tenantId: string; tenantName: string; billingEmail: string | null; planName: string; amount: number; currency: string; overdueSinceDate: string; daysOverdue: number }[];
  upcomingRenewals: { in7Days: number; in30Days: number };
  revenueByPlan: { plan: string; amount: number }[];
}

export interface FunnelData {
  period: { from: string; to: string };
  cohortSize: number;
  stages: { stage: string; count: number; conversionFromPrevPct: number | null }[];
}

export interface UsageData {
  period: { from: string; to: string };
  totals: { messagesSent: number; messagesReceived: number; newConversations: number; resolvedConversations: number; broadcastsSent: number; templatesCreated: number };
  dauWauMauTrend: { date: string; dau: number; wau: number; mau: number }[];
  stickinessRatio: number | null;
  featureAdoption: { feature: string; adoptionPct: number }[];
  powerUserHistogram: { bucket: string; tenantCount: number }[];
}

export interface PlatformHealthData {
  queueHealth: { name: string; waiting: number; active: number; completed: number; failed: number; delayed: number; reachable: boolean }[];
  whatsappQuality: { total: number; GREEN: number; YELLOW: number; RED: number; UNKNOWN: number };
  errorRateTrend: { date: string; sent: number; failed: number; errorRatePct: number }[];
  costEstimatePerTenant: { tenantId: string; tenantName: string; conversations: number; estimatedCostUsd: number; revenue: number; estimatedGrossMargin: number }[];
  dbPing: { reachable: boolean; latencyMs: number | null };
  aiProvider: { configured: boolean; lastSuccessfulCallAt: string | null; provider: string | null };
  paymentGateway: { stripeConfigured: boolean; paystackConfigured: boolean; lastSuccessfulPaymentAt: string | null; gateway: string | null };
  notInstrumented: string[];
}

export interface OverviewData {
  period: { from: string; to: string };
  mrr: { amountGhs: number; changePct: number | null; trend: { date: string; amountGhs: number }[] };
  arrGhs: number;
  activePayingTenants: number;
  trialsInProgress: number;
  trialToPaidConversionRate: number | null;
  netRevenueRetention: number | null;
  logoChurnRate: number | null;
  arpuGhs: number;
  mrrMovement: Record<'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURNED', {
    count: number; amountGhs: number;
    tenants: { tenantId: string; tenantName: string; mrrGhs: number; date: string }[];
  }>;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  gateway: string | null;
  gatewayInvoiceId: string | null;
  tenant: { id: string; name: string; billingEmail: string | null };
}

export interface CreditPurchase {
  id: string;
  credits: number;
  packSlug: string;
  amount: number;
  currency: string;
  gateway: string | null;
  paystackRef: string | null;
  status: string;
  createdAt: string;
  tenant: { name: string; billingEmail: string | null };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  tenant: { id: string; name: string };
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  isActive: boolean;
  isPublic: boolean;
  limMaxAgents: number;
  limMaxContacts: number;
  limMessagesPerMonth: number;
  limAiCreditsPerMonth: number;
  limMaxChannels: number;
  limMaxCampaigns: number;
  sortOrder: number;
}

// ── Admin RBAC ───────────────────────────────────────────────────────────────

export interface PlatformAdminRow {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ── Monitoring: errors & webhooks ───────────────────────────────────────────

export interface ErrorLogRow {
  id: string;
  tenantId: string | null;
  service: string;
  severity: 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  stack: string | null;
  requestId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  fingerprint: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  createdAt: string;
  tenant: { id: string; name: string } | null;
}

export interface WebhookEventRow {
  id: string;
  source: 'WHATSAPP' | 'STRIPE_BILLING' | 'PAYSTACK_BILLING' | 'PAYSTACK_COMMERCE';
  eventType: string;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED';
  gatewayEventId: string | null;
  tenantId: string | null;
  payload: unknown;
  error: string | null;
  attempts: number;
  createdAt: string;
  processedAt: string | null;
  tenant: { id: string; name: string } | null;
}

interface Paginated<T> { items: T[]; total: number; limit: number; offset: number }

// ── AI analytics ─────────────────────────────────────────────────────────────

export interface AiAnalyticsData {
  period: { from: string; to: string };
  totals: { calls: number; costUsd: number; revenueUsd: number; marginUsd: number };
  daily: { date: string; calls: number; costUsd: number; failed: number }[];
  byProvider: { provider: string; calls: number; costUsd: number }[];
  byModel: { provider: string; modelKey: string; calls: number; costUsd: number }[];
}

export interface AiUsageTopConsumersData {
  period: { from: string; to: string };
  items: { tenantId: string; tenantName: string; creditsConsumed: number; aiCalls: number }[];
}

export interface AiCreditWalletRow {
  tenantId: string;
  tenantName: string;
  balance: number;
  purchased: number;
  bonus: number;
  consumed: number;
  refunded: number;
  adjusted: number;
}

export interface AiCreditTransactionRow {
  id: string;
  tenantId: string;
  type: 'PURCHASE' | 'BONUS' | 'AI_USAGE' | 'REFUND' | 'ADJUSTMENT';
  credits: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  tenant: { id: string; name: string };
}

export interface AiPricingConfigRow {
  id: string;
  provider: string;
  modelKey: string;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  creditsPerUsd: number;
  isActive: boolean;
}

export interface AiCreditPackageRow {
  id: string;
  slug: string;
  name: string;
  credits: number;
  bonusCredits: number;
  priceGhs: number | null;
  priceUsd: number | null;
  isActive: boolean;
  displayOrder: number;
}

// ── Commerce analytics ───────────────────────────────────────────────────────

export interface CommerceAnalyticsData {
  period: { from: string; to: string };
  totals: { gmv: number; fees: number; refunds: number };
  daily: { date: string; gmv: number; fees: number; refunds: number }[];
  topTenants: { tenantId: string; tenantName: string; gmv: number }[];
}

export interface OrderRow {
  id: string;
  tenantId: string;
  status: string;
  currency: string;
  totalMajorUnits: number;
  customerName: string | null;
  customerPhone: string;
  createdAt: string;
  paidAt: string | null;
  tenant: { id: string; name: string };
}

export interface OrderDetail extends OrderRow {
  items: unknown[];
  events: { id: string; type: string; data: unknown; createdAt: string }[];
  ledgerEntries: { id: string; type: string; amountMajorUnits: number; createdAt: string }[];
}

export interface CommerceFeesData {
  period: { from: string; to: string };
  entries: { id: string; tenantId: string; orderId: string; type: string; amountMajorUnits: number; currency: string; createdAt: string; tenant: { id: string; name: string } }[];
  anomalies: { duplicateGmvOrderIds: string[] };
}

// ── Messaging analytics ──────────────────────────────────────────────────────

export interface MessagingAnalyticsData {
  period: { from: string; to: string };
  totals: { sent: number; delivered: number; read: number; failed: number; inbound: number };
  daily: { date: string; sent: number; delivered: number; read: number; failed: number; inbound: number }[];
  topFailingTenants: { tenantId: string; tenantName: string; sent: number; failed: number; errorRatePct: number }[];
}

// ── Payments (unified) ───────────────────────────────────────────────────────

export interface PaymentRow {
  id: string;
  tenantId: string;
  gateway: string;
  status: string;
  amount: number;
  currency: string;
  gatewayReference: string | null;
  createdAt: string;
  verifiedAt: string | null;
  failReason: string | null;
  tenant: { id: string; name: string };
}

// ── Audit logs ───────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  adminId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string } | null;
}

// ── Feature flags ────────────────────────────────────────────────────────────

export interface FeatureFlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rolloutType: string;
  rolloutPct: number;
  betaTenants: string[];
  environment: string;
  killSwitch: boolean;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { rollouts: number };
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResults {
  tenants: { id: string; name: string }[];
  users: { id: string; name: string | null; email: string; tenantId: string }[];
  orders: { id: string; customerName: string | null; customerPhone: string; tenantId: string; totalMajorUnits: number; currency: string }[];
  payments: { id: string; gatewayReference: string | null; gatewayPaymentId: string | null; tenantId: string; amount: number; currency: string }[];
}

export const adminApi = {
  setup: (setupSecret: string, email: string, name: string, password: string) =>
    req<{ message: string }>('POST', '/auth/setup', { setupSecret, email, name, password }),

  login: (email: string, password: string) =>
    req<{ token: string; admin: { id: string; email: string; name: string; role: string } }>(
      'POST', '/auth/login', { email, password },
    ),

  me: () =>
    req<{ id: string; email: string; name: string; role: string; lastLoginAt: string | null }>(
      'GET', '/auth/me',
    ),

  forgotPassword: (email: string) =>
    req<{ message: string }>('POST', '/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    req<{ message: string }>('POST', '/auth/reset-password', { token, password }),

  dashboard: () => req<AdminStats>('GET', '/dashboard'),

  overview: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return req<OverviewData>('GET', `/overview${qs ? `?${qs}` : ''}`);
  },

  workspaces: (opts: { search?: string; filter?: string; sort?: string; order?: 'asc' | 'desc'; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.filter) params.set('filter', opts.filter);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.order) params.set('order', opts.order);
    params.set('limit', String(opts.limit ?? 20));
    params.set('offset', String(opts.offset ?? 0));
    return req<{ tenants: TenantTableRow[]; total: number; limit: number; offset: number }>('GET', `/workspaces?${params.toString()}`);
  },

  /** CSV export respects the same search/filter/sort as the table -- returns the blob for the caller to trigger a download. */
  exportWorkspacesCsv: async (opts: { search?: string; filter?: string; sort?: string; order?: 'asc' | 'desc' } = {}) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.filter) params.set('filter', opts.filter);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.order) params.set('order', opts.order);
    const res = await fetch(`${BASE}/workspaces/export?${params.toString()}`, {
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },

  getWorkspace: (id: string) => req<WorkspaceDetail>('GET', `/workspaces/${id}`),

  suspendWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/suspend`),
  activateWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/activate`),

  allInvoices: (page = 1) =>
    req<{ invoices: Invoice[]; total: number }>('GET', `/billing/invoices?page=${page}&limit=20`),

  revenue: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return req<RevenueData>('GET', `/revenue${qs ? `?${qs}` : ''}`);
  },

  funnel: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return req<FunnelData>('GET', `/funnel${qs ? `?${qs}` : ''}`);
  },

  usage: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return req<UsageData>('GET', `/usage${qs ? `?${qs}` : ''}`);
  },

  platformHealth: () => req<PlatformHealthData>('GET', '/platform-health'),

  users: (page = 1, search = '', tenantId = '') =>
    req<{ users: AdminUser[]; total: number; page: number; limit: number }>(
      'GET', `/users?page=${page}&limit=30&search=${encodeURIComponent(search)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`,
    ),

  toggleUserActive: (id: string) =>
    req<{ id: string; isActive: boolean }>('PATCH', `/users/${id}/toggle-active`),

  plans: () => req<Plan[]>('GET', '/plans'),

  createPlan: (data: Omit<Plan, 'id'> & { description?: string }) => req<Plan>('POST', '/plans', data),
  updatePlan: (id: string, data: Partial<Plan>) => req<Plan>('PATCH', `/plans/${id}`, data),

  forceSubscription: (tenantId: string, planSlug: string) =>
    req<{ success: boolean; tenantId: string; plan: string; periodEnd: string }>(
      'PATCH', `/workspaces/${tenantId}/force-plan`, { planSlug },
    ),

  setCommerceConfig: (tenantId: string, commerceEnabled: boolean, takeRatePct: number) =>
    req<{ success: boolean; tenantId: string; commerceEnabled: boolean; takeRatePct: number }>(
      'PATCH', `/workspaces/${tenantId}/commerce`, { commerceEnabled, takeRatePct },
    ),

  // ── Admin RBAC ───────────────────────────────────────────────────────────

  listAdmins: () => req<PlatformAdminRow[]>('GET', '/admins'),
  inviteAdmin: (email: string, name: string, role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER') =>
    req<{ id: string; email: string; name: string; role: string; createdAt: string }>('POST', '/admins', { email, name, role }),
  updateAdminRole: (id: string, role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER') =>
    req<{ id: string; email: string; name: string; role: string }>('PATCH', `/admins/${id}/role`, { role }),

  // ── Monitoring: errors & webhooks ─────────────────────────────────────────

  errors: (opts: { status?: string; severity?: string; tenantId?: string; search?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<ErrorLogRow>>('GET', `/errors${qs(opts)}`),
  getError: (id: string) => req<ErrorLogRow>('GET', `/errors/${id}`),
  updateErrorStatus: (id: string, status: 'OPEN' | 'RESOLVED' | 'IGNORED') =>
    req<ErrorLogRow>('PATCH', `/errors/${id}/status`, { status }),

  webhookEvents: (opts: { source?: string; status?: string; tenantId?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<WebhookEventRow>>('GET', `/webhooks${qs(opts)}`),
  getWebhookEvent: (id: string) => req<WebhookEventRow>('GET', `/webhooks/${id}`),
  reprocessWebhookEvent: (id: string) => req<{ status: 'PROCESSED' | 'FAILED' }>('POST', `/webhooks/${id}/reprocess`),

  // ── AI analytics ───────────────────────────────────────────────────────────

  aiAnalytics: (from?: string, to?: string) => req<AiAnalyticsData>('GET', `/analytics/ai${qs({ from, to })}`),
  aiUsageTopConsumers: (from?: string, to?: string) => req<AiUsageTopConsumersData>('GET', `/ai/usage${qs({ from, to })}`),
  aiCreditWallets: (opts: { search?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<AiCreditWalletRow>>('GET', `/ai/credits/wallets${qs(opts)}`),
  aiCreditTransactions: (opts: { tenantId?: string; type?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<AiCreditTransactionRow>>('GET', `/ai/credits/transactions${qs(opts)}`),

  aiPricing: () => req<AiPricingConfigRow[]>('GET', '/ai/pricing'),
  createAiPricing: (data: Omit<AiPricingConfigRow, 'id' | 'isActive'> & { isActive?: boolean }) =>
    req<AiPricingConfigRow>('POST', '/ai/pricing', data),
  updateAiPricing: (id: string, data: Partial<Omit<AiPricingConfigRow, 'id' | 'provider' | 'modelKey'>>) =>
    req<AiPricingConfigRow>('PATCH', `/ai/pricing/${id}`, data),

  aiCreditPackages: () => req<AiCreditPackageRow[]>('GET', '/ai/credit-packages'),
  createAiCreditPackage: (data: Omit<AiCreditPackageRow, 'id'>) => req<AiCreditPackageRow>('POST', '/ai/credit-packages', data),
  updateAiCreditPackage: (id: string, data: Partial<Omit<AiCreditPackageRow, 'id' | 'slug'>>) =>
    req<AiCreditPackageRow>('PATCH', `/ai/credit-packages/${id}`, data),

  getDefaultCommerceFeePct: () => req<{ defaultCommerceFeePct: number }>('GET', '/settings/commerce-fee'),
  setDefaultCommerceFeePct: (defaultCommerceFeePct: number) =>
    req<{ defaultCommerceFeePct: number }>('PATCH', '/settings/commerce-fee', { defaultCommerceFeePct }),

  grantCredits: (tenantId: string, credits: number, description: string, type?: 'BONUS' | 'ADJUSTMENT') =>
    req<{ success: boolean; transaction: unknown }>('POST', `/workspaces/${tenantId}/credits/grant`, { credits, description, type }),

  workspaceTemplates: (tenantId: string) =>
    req<{ id: string; name: string; language: string; category: string; status: string; components: unknown }[]>('GET', `/workspaces/${tenantId}/templates`),

  // ── Commerce analytics ───────────────────────────────────────────────────────

  commerceAnalytics: (from?: string, to?: string) => req<CommerceAnalyticsData>('GET', `/analytics/commerce${qs({ from, to })}`),
  orders: (opts: { tenantId?: string; status?: string; search?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<OrderRow>>('GET', `/orders${qs(opts)}`),
  getOrder: (id: string) => req<OrderDetail>('GET', `/orders/${id}`),
  commerceFees: (from?: string, to?: string) => req<CommerceFeesData>('GET', `/commerce/fees${qs({ from, to })}`),

  // ── Messaging analytics ──────────────────────────────────────────────────────

  messagingAnalytics: (from?: string, to?: string) => req<MessagingAnalyticsData>('GET', `/analytics/messaging${qs({ from, to })}`),

  // ── Payments (unified) ───────────────────────────────────────────────────────

  payments: (opts: { tenantId?: string; status?: string; gateway?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<PaymentRow>>('GET', `/payments${qs(opts)}`),

  // ── Audit logs ───────────────────────────────────────────────────────────────

  auditLogs: (opts: { adminId?: string; action?: string; resourceType?: string; limit?: number; offset?: number } = {}) =>
    req<Paginated<AuditLogRow>>('GET', `/audit-logs${qs(opts)}`),

  // ── Feature flags ────────────────────────────────────────────────────────────

  featureFlags: () => req<FeatureFlagRow[]>('GET', '/feature-flags'),
  createFeatureFlag: (data: { key: string; name: string; description?: string; enabled?: boolean; category?: string }) =>
    req<FeatureFlagRow>('POST', '/feature-flags', data),
  updateFeatureFlag: (id: string, data: Partial<{ name: string; description: string; enabled: boolean; rolloutType: string; rolloutPct: number; betaTenants: string[]; environment: string; category: string; killSwitch: boolean }>) =>
    req<FeatureFlagRow>('PATCH', `/feature-flags/${id}`, data),
  setFeatureFlagRollout: (id: string, tenantId: string, enabled: boolean) =>
    req<{ id: string; flagId: string; tenantId: string; enabled: boolean }>('PATCH', `/feature-flags/${id}/rollout/${tenantId}`, { enabled }),

  // ── Search ────────────────────────────────────────────────────────────────────

  search: (q: string) => req<SearchResults>('GET', `/search${qs({ q })}`),
};

/** Builds a query string from an options object, skipping undefined/empty values. */
function qs(opts: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
