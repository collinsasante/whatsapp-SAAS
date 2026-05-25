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

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  gatewayInvoiceId: string | null;
  tenant: { name: string; billingEmail: string | null };
}

export interface CreditPurchase {
  id: string;
  credits: number;
  packSlug: string;
  amount: number;
  currency: string;
  paystackRef: string | null;
  status: string;
  createdAt: string;
  tenant: { name: string; billingEmail: string | null };
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

  dashboard: () => req<AdminStats>('GET', '/dashboard'),

  workspaces: (page = 1, search = '') =>
    req<{ tenants: Workspace[]; total: number; page: number; limit: number }>(
      'GET', `/workspaces?page=${page}&limit=20&search=${encodeURIComponent(search)}`,
    ),

  getWorkspace: (id: string) => req<Workspace & { _count: { users: number; conversations: number; messages: number; contacts: number }; invoices: Invoice[]; creditPurchases: CreditPurchase[] }>('GET', `/workspaces/${id}`),

  suspendWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/suspend`),
  activateWorkspace: (id: string) => req<{ id: string; name: string; isActive: boolean }>('PATCH', `/workspaces/${id}/activate`),

  pendingBilling: () =>
    req<{ invoices: Invoice[]; creditPurchases: CreditPurchase[] }>('GET', '/billing/pending'),

  allInvoices: (page = 1) =>
    req<{ invoices: Invoice[]; total: number }>('GET', `/billing/invoices?page=${page}&limit=20`),

  activateSubscription: (reference: string) =>
    req<{ activated?: boolean; alreadyActivated?: boolean }>('POST', '/billing/activate', { reference }),

  activateCredits: (reference: string) =>
    req<{ activated?: boolean; alreadyActivated?: boolean; creditsAdded?: number }>('POST', '/billing/activate-credits', { reference }),

  plans: () => req<Plan[]>('GET', '/plans'),

  updatePlan: (id: string, data: Partial<Plan>) => req<Plan>('PATCH', `/plans/${id}`, data),
};
