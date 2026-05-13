import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

// Deduplicate concurrent refresh calls — only one in-flight at a time
let refreshPromise: Promise<string> | null = null;

async function silentRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = axios
    .post<{ accessToken: string }>(
      `${API_URL}/auth/refresh`,
      {},
      { withCredentials: true }, // sends the HttpOnly refresh_token cookie
    )
    .then((r) => {
      const token = r.data.accessToken;
      localStorage.setItem('access_token', token);
      // Update Zustand store without importing the hook (avoids circular deps)
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('auth:token-refreshed', { detail: { accessToken: token } });
        window.dispatchEvent(event);
      }
      return token;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    withCredentials: true, // always send cookies (needed for refresh_token cookie)
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          const newToken = await silentRefresh();
          if (originalRequest.headers) {
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
          }
          return client(originalRequest);
        } catch {
          // Refresh failed — clear local access token and redirect to login
          // Do NOT clear auth-storage (user/tenant identity); let the dashboard
          // layout handle the redirect so it can show the login page gracefully.
          localStorage.removeItem('access_token');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth:session-expired'));
          }
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export const api = createApiClient();
export { silentRefresh };

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (name: string, email: string, password: string, phoneNumber?: string) =>
    api.post('/auth/register', { name, email, password, ...(phoneNumber ? { phoneNumber } : {}) }),
  logout: () => api.post('/auth/logout'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
  googleUrl: () => `${API_URL}/auth/google`,
};

export const conversationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/conversations', { params }),
  get: (id: string) => api.get(`/conversations/${id}`),
  create: (data: Record<string, unknown>) => api.post('/conversations', data),
  findOrCreate: (contactId: string) => api.post('/conversations/find-or-create', { contactId }),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/conversations/${id}`, data),
  resolve: (id: string) => api.patch(`/conversations/${id}/resolve`),
  archive: (id: string) => api.patch(`/conversations/${id}`, { status: 'ARCHIVED' }),
  delete: (id: string) => api.delete(`/conversations/${id}`),
  markRead: (id: string) => api.patch(`/conversations/${id}/read`),
  addNote: (id: string, content: string) => api.post(`/conversations/${id}/notes`, { content }),
  getNotes: (id: string) => api.get(`/conversations/${id}/notes`),
  // State machine transitions
  request: (id: string, reason?: string) => api.post(`/conversations/${id}/request`, { reason }),
  intervene: (id: string) => api.post(`/conversations/${id}/intervene`),
  reopen: (id: string) => api.post(`/conversations/${id}/reopen`),
  transfer: (id: string, toAgentId: string, reason?: string) => api.post(`/conversations/${id}/transfer`, { toAgentId, reason }),
  getCounts: () => api.get('/conversations/counts'),
  getEvents: (id: string) => api.get(`/conversations/${id}/events`),
};

export const messagesApi = {
  list: (conversationId: string, params?: Record<string, unknown>) =>
    api.get(`/conversations/${conversationId}/messages`, { params }),
  send: (conversationId: string, data: Record<string, unknown>) =>
    api.post(`/conversations/${conversationId}/messages`, data),
  delete: (conversationId: string, messageId: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}`),
  react: (conversationId: string, messageId: string, emoji: string) =>
    api.post(`/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),
  removeReact: (conversationId: string, messageId: string, emoji: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}/react`, { data: { emoji } }),
  edit: (conversationId: string, messageId: string, content: string) =>
    api.patch(`/conversations/${conversationId}/messages/${messageId}`, { content }),
  deleteForMe: (conversationId: string, messageId: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}?scope=me`),
  deleteForEveryone: (conversationId: string, messageId: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}?scope=everyone`),
  star: (conversationId: string, messageId: string) =>
    api.patch(`/conversations/${conversationId}/messages/${messageId}/star`),
  pin: (conversationId: string, messageId: string) =>
    api.patch(`/conversations/${conversationId}/messages/${messageId}/pin`),
};

export const contactsApi = {
  list: (params?: Record<string, unknown>) => api.get('/contacts', { params }),
  get: (id: string) => api.get(`/contacts/${id}`),
  create: (data: Record<string, unknown>) => api.post('/contacts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/contacts/${id}`, data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
  import: (contacts: unknown[]) => api.post('/contacts/import', { contacts }),
};

export const templatesApi = {
  list: (params?: Record<string, unknown>) => api.get('/templates', { params }),
  get: (id: string) => api.get(`/templates/${id}`),
  create: (data: Record<string, unknown>) => api.post('/templates', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/templates/${id}`, data),
  delete: (id: string) => api.delete(`/templates/${id}`),
  deleteWithMeta: (id: string) => api.delete(`/templates/${id}/with-meta`),
  submit: (id: string) => api.post(`/templates/${id}/submit`),
  sync: () => api.post('/templates/sync'),
};

export const campaignsApi = {
  list: (params?: Record<string, unknown>) => api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: Record<string, unknown>) => api.post('/campaigns', data),
  launch: (id: string) => api.post(`/campaigns/${id}/launch`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
  estimateRecipients: (data: { segmentId?: string; labels?: string[]; phones?: string[] }) =>
    api.post('/campaigns/estimate-recipients', data),
  getRecipients: (id: string, params?: Record<string, unknown>) =>
    api.get(`/campaigns/${id}/recipients`, { params }),
};

export const automationApi = {
  list: () => api.get('/automation'),
  get: (id: string) => api.get(`/automation/${id}`),
  create: (data: Record<string, unknown>) => api.post('/automation', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/automation/${id}`, data),
  delete: (id: string) => api.delete(`/automation/${id}`),
};

export const mediaApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  list: (params?: Record<string, unknown>) => api.get('/media', { params }),
  library: (params?: Record<string, unknown>) => api.get('/media/library', { params }),
  deleteAsset: (id: string) => api.delete(`/media/${id}`),
};

export const callsApi = {
  list: (params?: Record<string, unknown>) => api.get('/calls', { params }),
  get: (id: string) => api.get(`/calls/${id}`),
  create: (data: Record<string, unknown>) => api.post('/calls', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/calls/${id}`, data),
  delete: (id: string) => api.delete(`/calls/${id}`),
  addNote: (id: string, content: string) => api.post(`/calls/${id}/notes`, { content }),
  stats: () => api.get('/calls/stats'),
  archive: (id: string) => api.patch(`/calls/${id}/archive`),
  mute: (id: string, muted: boolean) => api.patch(`/calls/${id}/mute`, { muted }),
  hold: (id: string, held: boolean) => api.patch(`/calls/${id}/hold`, { held }),
  transfer: (id: string, toUserId: string, reason?: string, transferType?: string) =>
    api.post(`/calls/${id}/transfer`, { toUserId, reason, transferType }),
  generateLink: () => api.post('/calls/links/generate'),
  analytics: (params?: Record<string, unknown>) => api.get('/calls/analytics', { params }),
};

export const tenantApi = {
  get: () => api.get('/tenant'),
  getStats: () => api.get('/tenant/stats'),
  update: (data: Record<string, unknown>) => api.patch('/tenant', data),
  updateSettings: (data: Record<string, unknown>) => api.patch('/tenant/settings', data),
  updateOnboarding: (data: Record<string, unknown>) => api.patch('/tenant/onboarding', data),
};

export const usersApi = {
  list: () => api.get('/users'),
  create: (data: Record<string, unknown>) => api.post('/users', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data),
  deactivate: (id: string) => api.delete(`/users/${id}`),
};

export const dashboardApi = {
  overview: () => api.get('/dashboard/overview'),
  teamStats: () => api.get('/dashboard/team'),
  conversationTrend: (days = 30) => api.get('/dashboard/conversation-trend', { params: { days } }),
  conversationStats: (from: string, to: string) => api.get('/dashboard/conversation-stats', { params: { from, to } }),
  whatsappStatus: () => api.get('/dashboard/whatsapp-status'),
};

export const channelsApi = {
  list: () => api.get('/channels'),
  get: (id: string) => api.get(`/channels/${id}`),
  create: (data: Record<string, unknown>) => api.post('/channels', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/channels/${id}`, data),
  toggle: (id: string) => api.patch(`/channels/${id}/toggle`),
  delete: (id: string) => api.delete(`/channels/${id}`),
};

export const activityLogApi = {
  list: (params?: Record<string, unknown>) => api.get('/activity-logs', { params }),
  forConversation: (conversationId: string) => api.get(`/activity-logs/conversation/${conversationId}`),
};

export const notificationsApi = {
  list: (limit = 30) => api.get('/notifications', { params: { limit } }),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

export const cannedResponsesApi = {
  list: () => api.get('/canned-responses'),
  search: (q: string) => api.get('/canned-responses/search', { params: { q } }),
  create: (data: { shortcut: string; content: string; category?: string }) =>
    api.post('/canned-responses', data),
  update: (id: string, data: Partial<{ shortcut: string; content: string; category: string }>) =>
    api.patch(`/canned-responses/${id}`, data),
  delete: (id: string) => api.delete(`/canned-responses/${id}`),
};

export const apiKeysApi = {
  list: () => api.get('/api-keys'),
  create: (data: { name: string; expiresAt?: string }) => api.post('/api-keys', data),
  revoke: (id: string) => api.post(`/api-keys/${id}/revoke`),
  delete: (id: string) => api.delete(`/api-keys/${id}`),
};

export const chatbotFlowsApi = {
  list: () => api.get('/chatbot-flows'),
  get: (id: string) => api.get(`/chatbot-flows/${id}`),
  create: (data: Record<string, unknown>) => api.post('/chatbot-flows', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/chatbot-flows/${id}`, data),
  delete: (id: string) => api.delete(`/chatbot-flows/${id}`),
};

export const messageActionsApi = {
  react: (conversationId: string, messageId: string, emoji: string) =>
    api.post(`/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),
  removeReaction: (conversationId: string, messageId: string, emoji: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}/react`, { data: { emoji } }),
  star: (conversationId: string, messageId: string) =>
    api.patch(`/conversations/${conversationId}/messages/${messageId}/star`),
  pin: (conversationId: string, messageId: string) =>
    api.patch(`/conversations/${conversationId}/messages/${messageId}/pin`),
};

export const segmentsApi = {
  list: () => api.get('/segments'),
  create: (data: { name: string; description?: string; filters: unknown[] }) => api.post('/segments', data),
  update: (id: string, data: { name?: string; description?: string; filters?: unknown[] }) => api.patch(`/segments/${id}`, data),
  delete: (id: string) => api.delete(`/segments/${id}`),
  refreshCount: (id: string) => api.post(`/segments/${id}/refresh-count`),
};

export const tagsApi = {
  list: () => api.get('/manage/tags'),
  create: (data: { name: string; color?: string }) => api.post('/manage/tags', data),
  update: (id: string, data: { name?: string; color?: string }) => api.patch(`/manage/tags/${id}`, data),
  delete: (id: string) => api.delete(`/manage/tags/${id}`),
};

export const attributesApi = {
  list: () => api.get('/manage/attributes'),
  create: (data: Record<string, unknown>) => api.post('/manage/attributes', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/manage/attributes/${id}`, data),
  delete: (id: string) => api.delete(`/manage/attributes/${id}`),
};

export const billingApi = {
  getStatus: () => api.get('/billing'),
  getUsage: () => api.get('/billing/usage'),
  getInvoices: () => api.get('/billing/invoices'),
  upgradePlan: (plan: string) => api.post('/billing/upgrade', { plan }),
  updateBillingEmail: (billingEmail: string) => api.patch('/billing/email', { billingEmail }),
};

export const teamsApi = {
  list: () => api.get('/teams'),
  getUsers: () => api.get('/teams/users'),
  create: (data: { name: string; description?: string }) => api.post('/teams', data),
  update: (id: string, data: { name?: string; description?: string }) => api.patch(`/teams/${id}`, data),
  delete: (id: string) => api.delete(`/teams/${id}`),
  addMember: (id: string, userId: string) => api.post(`/teams/${id}/members`, { userId }),
  removeMember: (id: string, userId: string) => api.delete(`/teams/${id}/members/${userId}`),
};

export const webhooksApi = {
  list: () => api.get('/manage/webhooks'),
  create: (data: { name: string; url: string; events?: string[]; secret?: string }) =>
    api.post('/manage/webhooks', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/manage/webhooks/${id}`, data),
  delete: (id: string) => api.delete(`/manage/webhooks/${id}`),
  test: (id: string) => api.post(`/manage/webhooks/${id}/test`),
};

export const manageSettingsApi = {
  get: () => api.get('/manage/settings'),
  updateWelcome: (data: { welcomeEnabled?: boolean; welcomeMessage?: string }) =>
    api.patch('/manage/settings/welcome', data),
  updateOffHours: (data: Record<string, unknown>) => api.patch('/manage/settings/off-hours', data),
  updateOptInOut: (data: Record<string, unknown>) => api.patch('/manage/settings/opt-in-out', data),
  updateWidget: (data: Record<string, unknown>) => api.patch('/manage/settings/widget', data),
};
