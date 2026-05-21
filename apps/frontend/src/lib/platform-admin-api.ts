import axios from 'axios';

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1') + '/platform-admin';

export const adminHttp = axios.create({ baseURL: BASE });

adminHttp.interceptors.request.use((cfg) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('pa_token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

adminHttp.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('pa_token');
      window.location.href = '/platform-admin/login';
    }
    return Promise.reject(err);
  },
);

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdminMe {
  id: string;
  email: string;
  name: string;
}

export interface DashboardStats {
  workspaces: { total: number; active: number; suspended: number; newThisMonth: number };
  users: { total: number; active: number };
  conversations: { total: number; open: number };
  messages: { total: number; today: number };
  channels: { total: number; active: number };
  campaigns: { total: number; sent: number; delivered: number; read: number; failed: number };
  contacts: { total: number };
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  _count?: { users: number; conversations: number; channels: number };
  owner?: { id: string; email: string; name: string };
  suspendedAt?: string | null;
  suspendReason?: string | null;
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  tenant?: { id: string; name: string; plan: string };
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  adminId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  admin?: { email: string; name: string };
}

// ── API Methods ───────────────────────────────────────────────────────────────

export const platformAdminApi = {
  login: (email: string, password: string) =>
    adminHttp.post<{ accessToken: string; admin: AdminMe }>('/auth/login', { email, password }),

  getMe: () => adminHttp.get<AdminMe>('/auth/me'),

  logout: () => adminHttp.post('/auth/logout').catch(() => null),

  getStats: () => adminHttp.get<DashboardStats>('/dashboard/stats'),

  listWorkspaces: (params?: { page?: number; limit?: number; search?: string; status?: string }) =>
    adminHttp.get<{ data: Workspace[]; total: number; page: number; limit: number }>('/workspaces', { params }),

  getWorkspace: (id: string) => adminHttp.get<Workspace>(`/workspaces/${id}`),

  suspendWorkspace: (id: string, reason: string) =>
    adminHttp.post(`/workspaces/${id}/suspend`, { reason }),

  reactivateWorkspace: (id: string) => adminHttp.post(`/workspaces/${id}/reactivate`),

  deleteWorkspace: (id: string) => adminHttp.delete(`/workspaces/${id}`),

  updateWorkspacePlan: (id: string, plan: string) =>
    adminHttp.patch(`/workspaces/${id}/plan`, { plan }),

  impersonateWorkspace: (id: string) =>
    adminHttp.post<{ accessToken: string; tenant: { id: string; name: string } }>(`/workspaces/${id}/impersonate`),

  listUsers: (params?: { page?: number; limit?: number; search?: string }) =>
    adminHttp.get<{ data: PlatformUser[]; total: number; page: number; limit: number }>('/users', { params }),

  getAnalytics: (days = 30) =>
    adminHttp.get<Record<string, unknown>>('/analytics', { params: { days } }),

  getAuditLog: (params?: { page?: number; limit?: number }) =>
    adminHttp.get<{ data: AuditEntry[]; total: number }>('/audit', { params }),

  // Feature Flags
  listFlags: () => adminHttp.get<FeatureFlag[]>('/feature-flags'),
  createFlag: (data: Partial<FeatureFlag>) => adminHttp.post<FeatureFlag>('/feature-flags', data),
  updateFlag: (id: string, data: Partial<FeatureFlag>) => adminHttp.patch<FeatureFlag>(`/feature-flags/${id}`, data),
  deleteFlag: (id: string) => adminHttp.delete(`/feature-flags/${id}`),
  getFlagRollouts: (id: string) => adminHttp.get<FlagRollout[]>(`/feature-flags/${id}/rollouts`),
  setFlagRollout: (id: string, tenantId: string, enabled: boolean) =>
    adminHttp.post(`/feature-flags/${id}/rollouts`, { tenantId, enabled }),
  removeFlagRollout: (id: string, tenantId: string) =>
    adminHttp.delete(`/feature-flags/${id}/rollouts/${tenantId}`),

  // Releases
  listVersions: () => adminHttp.get<AppVersion[]>('/releases/versions'),
  createVersion: (data: Partial<AppVersion>) => adminHttp.post<AppVersion>('/releases/versions', data),
  updateVersion: (id: string, data: Partial<AppVersion>) => adminHttp.patch<AppVersion>(`/releases/versions/${id}`, data),
  listDeployments: (environment?: string) =>
    adminHttp.get<DeploymentLog[]>('/releases/deployments', { params: environment ? { environment } : {} }),
  logDeployment: (data: Partial<DeploymentLog>) => adminHttp.post<DeploymentLog>('/releases/deployments', data),
};

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rolloutType: string;
  rolloutPct: number;
  betaTenants: string[];
  environment: string;
  killSwitch: boolean;
  category?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { rollouts: number };
}

export interface FlagRollout {
  id: string;
  flagId: string;
  tenantId: string;
  enabled: boolean;
  createdAt: string;
  tenant?: { id: string; name: string; plan: string };
}

export interface AppVersion {
  id: string;
  version: string;
  major: number;
  minor: number;
  patch: number;
  channel: string;
  releasedAt: string;
  description?: string;
  changelog?: {
    features?: string[];
    improvements?: string[];
    fixes?: string[];
    breaking?: string[];
    security?: string[];
  };
  isLatest: boolean;
  _count?: { deployments: number };
}

export interface DeploymentLog {
  id: string;
  version: string;
  versionId?: string;
  commitHash?: string;
  branch?: string;
  environment: string;
  deployedBy?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  notes?: string;
  buildDuration?: number;
  appVersion?: { version: string; channel: string };
}
