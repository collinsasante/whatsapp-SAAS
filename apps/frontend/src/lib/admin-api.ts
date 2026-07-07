const BASE = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1') + '/platform-admin';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('admin_token') ?? '';
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    window.location.href = '/platform-admin/login';
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => ({ message: 'Request failed' }));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? 'Request failed');
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
  tenant: { name: string; billingEmail: string | null };
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

  getWorkspace: (id: string) => req<WorkspaceDetail>('GET', `/workspaces/${id}`),

  suspendWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/suspend`),
  activateWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/activate`),

  allInvoices: (page = 1) =>
    req<{ invoices: Invoice[]; total: number }>('GET', `/billing/invoices?page=${page}&limit=20`),

  users: (page = 1, search = '') =>
    req<{ users: AdminUser[]; total: number; page: number; limit: number }>(
      'GET', `/users?page=${page}&limit=30&search=${encodeURIComponent(search)}`,
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
};
