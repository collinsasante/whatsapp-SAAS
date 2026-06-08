import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

// Deduplicate concurrent refresh calls — only one in-flight at a time
let refreshPromise: Promise<string> | null = null;
// Once refresh fails, stop retrying until the user logs in again
let sessionDead = false;

async function silentRefresh(): Promise<string> {
  if (sessionDead) return Promise.reject(new Error('Session expired'));
  if (refreshPromise) return refreshPromise;
  refreshPromise = axios
    .post<{ accessToken: string }>(
      `${API_URL}/auth/refresh`,
      {},
      { withCredentials: true }, // sends the HttpOnly refresh_token cookie
    )
    .then((r) => {
      const token = r.data.accessToken;
      sessionDead = false;
      localStorage.setItem('access_token', token);
      // Update Zustand store without importing the hook (avoids circular deps)
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('auth:token-refreshed', { detail: { accessToken: token } });
        window.dispatchEvent(event);
      }
      return token;
    })
    .catch((err) => {
      // Only treat session as permanently dead when the refresh endpoint explicitly
      // rejects the token (401). Network errors and 5xx are transient — don't log
      // the user out for a momentary backend hiccup or container restart.
      if (err?.response?.status === 401) {
        sessionDead = true;
      }
      throw err;
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
    (response) => {
      // Any successful response means we have a live session — reset the flag
      sessionDead = false;
      return response;
    },
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
          // Only log the user out if the refresh token itself was rejected (401).
          // Transient errors (network, 5xx) leave sessionDead=false so the next
          // 401 will attempt refresh again rather than forcing a logout.
          if (sessionDead) {
            localStorage.removeItem('access_token');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth:session-expired'));
            }
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
  verify2FA: (tempToken: string, pin: string) =>
    api.post('/auth/verify-2fa', { tempToken, code: pin }),
  setupPin: (tempToken: string, pin: string) =>
    api.post('/auth/setup-pin', { tempToken, pin }),
  selectWorkspace: (tempToken: string, tenantId: string) =>
    api.post('/auth/select-workspace', { tempToken, tenantId }),
  register: (name: string, email: string, password: string, phoneNumber?: string) =>
    api.post('/auth/register', { name, email, password, ...(phoneNumber ? { phoneNumber } : {}) }),
  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),
  logout: () => api.post('/auth/logout'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
  googleUrl: () => `${API_URL}/auth/google`,
  getWorkspaces: () => api.get('/auth/workspaces'),
  switchWorkspace: (workspaceId: string) => api.post('/auth/switch-workspace', { workspaceId }),
  verifyInvite: (token: string) => api.get(`/auth/invite/verify/${token}`),
  acceptInvite: (token: string, name?: string, password?: string) =>
    api.post('/auth/invite/accept', { token, name, password }),
  getMe: () => api.get('/auth/me'),
  updateMe: (data: { name?: string; avatarUrl?: string }) => api.patch('/auth/me', data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/auth/me/password', { currentPassword, newPassword }),
  changePin: (currentPin: string | undefined, newPin: string) =>
    api.patch('/auth/me/pin', { ...(currentPin ? { currentPin } : {}), newPin }),
};

export const workspaceApi = {
  listMembers: () => api.get('/workspace/members'),
  invite: (email: string, role?: string, name?: string) =>
    api.post('/workspace/invite', { email, role, name }),
  listInvitations: () => api.get('/workspace/invitations'),
  cancelInvitation: (id: string) => api.delete(`/workspace/invitations/${id}`),
  editMember: (id: string, data: {
    name?: string; email?: string; phone?: string; avatarUrl?: string;
    role?: string; department?: string; status?: string;
  }) => api.patch(`/workspace/members/${id}`, data),
  suspendMember: (id: string) => api.patch(`/workspace/members/${id}/suspend`),
  reactivateMember: (id: string) => api.patch(`/workspace/members/${id}/reactivate`),
  forceLogout: (id: string) => api.post(`/workspace/members/${id}/force-logout`),
  resetPassword: (id: string, newPassword: string) =>
    api.post(`/workspace/members/${id}/reset-password`, { newPassword }),
  getMemberActivity: (id: string) => api.get(`/workspace/members/${id}/activity`),
  getMemberConversations: (id: string) => api.get(`/workspace/members/${id}/conversations`),
  removeMember: (id: string, reassignToId?: string) =>
    api.delete(`/workspace/members/${id}`, { data: { reassignToId } }),
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
  markUnread: (id: string) => api.patch(`/conversations/${id}/mark-unread`),
  takeover: (id: string) => api.post(`/conversations/${id}/takeover`),
  addNote: (id: string, content: string) => api.post(`/conversations/${id}/notes`, { content }),
  getNotes: (id: string) => api.get(`/conversations/${id}/notes`),
  editNote: (id: string, noteId: string, content: string) => api.patch(`/conversations/${id}/notes/${noteId}`, { content }),
  deleteNote: (id: string, noteId: string) => api.delete(`/conversations/${id}/notes/${noteId}`),
  // State machine transitions
  request: (id: string, reason?: string) => api.post(`/conversations/${id}/request`, { reason }),
  intervene: (id: string) => api.post(`/conversations/${id}/intervene`),
  reopen: (id: string) => api.post(`/conversations/${id}/reopen`),
  transfer: (id: string, toAgentId: string, reason?: string) => api.post(`/conversations/${id}/transfer`, { toAgentId, reason }),
  getCounts: () => api.get('/conversations/counts'),
  getEvents: (id: string) => api.get(`/conversations/${id}/events`),
  importCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/conversations/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  summarize: (id: string) => api.post(`/conversations/${id}/summarize`),
};

export const messagesApi = {
  list: (conversationId: string, params?: Record<string, unknown>) =>
    api.get(`/conversations/${conversationId}/messages`, { params }),
  send: (conversationId: string, data: Record<string, unknown>) =>
    api.post(`/conversations/${conversationId}/messages`, data),
  react: (conversationId: string, messageId: string, emoji: string) =>
    api.post(`/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),
  removeReact: (conversationId: string, messageId: string, emoji: string) =>
    api.delete(`/conversations/${conversationId}/messages/${messageId}/react`, { data: { emoji } }),
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
  block: (id: string) => api.patch(`/contacts/${id}/block`),
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
  resume: (id: string) => api.post(`/campaigns/${id}/resume`),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
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
    return api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 });
  },
  list: (params?: Record<string, unknown>) => api.get('/media', { params }),
  library: (params?: Record<string, unknown>) => api.get('/media/library', { params }),
  assets: (params?: Record<string, unknown>) => api.get('/media', { params }),
  deleteAsset: (id: string) => api.delete(`/media/${id}`),
  deduplicate: () => api.post('/media/deduplicate'),
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
  initiate: (data: { phone: string; contactId?: string; type?: 'audio' | 'video'; sdpOffer?: string }) =>
    api.post('/calls/initiate', data),
  respond: (id: string, action: 'pre_accept' | 'accept' | 'reject' | 'terminate', sdpAnswer?: string) =>
    api.post(`/calls/${id}/respond`, { action, sdpAnswer }),
  generateLink: () => api.post('/calls/links/generate'),
  analytics: (params?: Record<string, unknown>) => api.get('/calls/analytics', { params }),
  getPermission: (phone: string) => api.get('/calls/permissions', { params: { phone } }),
  requestPermission: (phone: string) => api.post('/calls/permissions/request', { phone }),
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
  businessProfile: () => api.get('/dashboard/business-profile'),
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
  search: (q: string, categoryId?: string) =>
    api.get('/canned-responses/search', { params: { q, ...(categoryId ? { categoryId } : {}) } }),
  getFavorites: () => api.get('/canned-responses/favorites'),
  getRecent: () => api.get('/canned-responses/recent'),
  create: (data: {
    title?: string;
    shortcut: string;
    content: string;
    categoryId?: string;
    tags?: string[];
    mediaUrl?: string;
    mediaType?: string;
  }) => api.post('/canned-responses', data),
  update: (id: string, data: Partial<{
    title: string;
    shortcut: string;
    content: string;
    categoryId: string | null;
    tags: string[];
    mediaUrl: string | null;
    mediaType: string | null;
  }>) => api.patch(`/canned-responses/${id}`, data),
  delete: (id: string) => api.delete(`/canned-responses/${id}`),
  toggleFavorite: (id: string) => api.post(`/canned-responses/${id}/favorite`),
  trackUsage: (id: string) => api.post(`/canned-responses/${id}/use`),
  // Categories
  listCategories: () => api.get('/canned-responses/categories'),
  createCategory: (data: { name: string; color?: string; icon?: string; sortOrder?: number }) =>
    api.post('/canned-responses/categories', data),
  updateCategory: (id: string, data: Partial<{ name: string; color: string; icon: string; sortOrder: number }>) =>
    api.patch(`/canned-responses/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/canned-responses/categories/${id}`),
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
  getPlans: () => api.get('/billing/plans'),
  getUsage: () => api.get('/billing/usage'),
  getUsageHistory: () => api.get('/billing/usage/history'),
  getInvoices: () => api.get('/billing/invoices'),
  initiateCheckout: (data: { planSlug: string; cycle: string; billingEmail?: string }) =>
    api.post('/billing/checkout', data),
  applyPromoCode: (code: string, planSlug: string) => api.post('/billing/promo', { code, planSlug }),
  startTrial: (planSlug: string) => api.post(`/billing/trial/${planSlug}`),
  cancelSubscription: (immediately?: boolean) => api.delete('/billing/cancel', { data: { immediately } }),
  updateBillingEmail: (billingEmail: string) => api.post('/billing/email', { billingEmail }),
  getCreditPacks: () => api.get('/billing/credits/packs'),
  getAiCredits: () => api.get('/billing/credits/balance'),
  initializeCreditPurchase: (packSlug: string) =>
    api.post('/billing/credits/initialize', { packSlug }),
  notifyPaymentConfirmed: (reference: string) =>
    api.post('/billing/payment-confirmed', { reference }),
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
  updateAi: (data: { aiEnabled?: boolean; aiAlwaysOn?: boolean; aiPersonality?: string }) =>
    api.patch('/manage/settings/ai', data),
  approveAi: () => api.post('/manage/settings/ai/approve', {}),
};

export const publicApi = {
  currentVersion: () => api.get<{ version: string; channel: string; changelog?: Record<string, string[]>; releasedAt: string }>('/public/version'),
  featureFlags: (tenantId?: string) =>
    tenantId ? api.get<Record<string, boolean>>('/feature-flags/my') : Promise.resolve({ data: {} as Record<string, boolean> }),
};

export const whatsappNumbersApi = {
  list: () => api.get('/whatsapp-numbers'),
  create: (data: { label: string; phoneNumberId: string; wabaId: string; accessToken: string; isDefault?: boolean }) =>
    api.post('/whatsapp-numbers', data),
  update: (id: string, data: { label?: string; phoneNumberId?: string; wabaId?: string; accessToken?: string; isActive?: boolean }) =>
    api.patch(`/whatsapp-numbers/${id}`, data),
  setDefault: (id: string) => api.patch(`/whatsapp-numbers/${id}/set-default`),
  delete: (id: string) => api.delete(`/whatsapp-numbers/${id}`),
};

export const knowledgeBaseApi = {
  list: () => api.get('/knowledge-base'),
  create: (data: { title: string; content: string; isActive?: boolean }) =>
    api.post('/knowledge-base', data),
  update: (id: string, data: { title?: string; content?: string; isActive?: boolean }) =>
    api.patch(`/knowledge-base/${id}`, data),
  delete: (id: string) => api.delete(`/knowledge-base/${id}`),
  learn: () => api.post('/knowledge-base/learn'),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/knowledge-base/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  scrape: (url: string) => api.post('/knowledge-base/scrape', { url }),
};
