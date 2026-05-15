import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const adminAxios = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach admin token from localStorage on every request
adminAxios.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('pa-admin-storage');
      if (stored) {
        const parsed = JSON.parse(stored) as { state?: { accessToken?: string } };
        const token = parsed?.state?.accessToken;
        if (token) config.headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // ignore
    }
  }
  return config;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

export const adminAuthApi = {
  setup: (data: { email: string; password: string; name: string; setupSecret: string }) =>
    adminAxios.post('/platform-admin/auth/setup', data),
  login: (data: { email: string; password: string }) =>
    adminAxios.post('/platform-admin/auth/login', data),
  me: () => adminAxios.get('/platform-admin/auth/me'),
  logout: () => adminAxios.post('/platform-admin/auth/logout'),
  sessions: () => adminAxios.get('/platform-admin/auth/sessions'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const adminDashboardApi = {
  stats: () => adminAxios.get('/platform-admin/dashboard/stats'),
};

// ── Workspaces ────────────────────────────────────────────────────────────────

export const adminWorkspacesApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    adminAxios.get('/platform-admin/workspaces', { params }),
  get: (id: string) => adminAxios.get(`/platform-admin/workspaces/${id}`),
  suspend: (id: string, reason?: string) =>
    adminAxios.post(`/platform-admin/workspaces/${id}/suspend`, { reason }),
  reactivate: (id: string) =>
    adminAxios.post(`/platform-admin/workspaces/${id}/reactivate`),
  updatePlan: (id: string, plan: string) =>
    adminAxios.patch(`/platform-admin/workspaces/${id}/plan`, { plan }),
  delete: (id: string) => adminAxios.delete(`/platform-admin/workspaces/${id}`),
  impersonate: (id: string) =>
    adminAxios.post(`/platform-admin/workspaces/${id}/impersonate`),
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const adminUsersApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    adminAxios.get('/platform-admin/users', { params }),
  suspend: (id: string) => adminAxios.post(`/platform-admin/users/${id}/suspend`),
  reactivate: (id: string) => adminAxios.post(`/platform-admin/users/${id}/reactivate`),
  forceLogout: (id: string) => adminAxios.post(`/platform-admin/users/${id}/force-logout`),
};

// ── Channels ──────────────────────────────────────────────────────────────────

export const adminChannelsApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    adminAxios.get('/platform-admin/channels', { params }),
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const adminAnalyticsApi = {
  get: (days = 30) => adminAxios.get('/platform-admin/analytics', { params: { days } }),
};

// ── Audit ─────────────────────────────────────────────────────────────────────

export const adminAuditApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    adminAxios.get('/platform-admin/audit', { params }),
};

// ── Settings ──────────────────────────────────────────────────────────────────

export const adminSettingsApi = {
  getAll: () => adminAxios.get('/platform-admin/settings'),
  upsert: (key: string, value: unknown, description?: string) =>
    adminAxios.post('/platform-admin/settings', { key, value, description }),
};
