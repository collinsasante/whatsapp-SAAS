import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    timeout: 30000,
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
          const refreshToken = localStorage.getItem('refresh_token');
          if (!refreshToken) throw new Error('No refresh token');

          const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
          const { accessToken } = response.data as { accessToken: string };
          localStorage.setItem('access_token', accessToken);
          if (originalRequest.headers) {
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
          }
          return client(originalRequest);
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export const api = createApiClient();

export const authApi = {
  login: (email: string, password: string, tenantSlug: string) =>
    api.post('/auth/login', { email, password, tenantSlug }),
  register: (workspaceName: string, name: string, email: string, password: string) =>
    api.post('/auth/register', { workspaceName, name, email, password }),
  logout: () => api.post('/auth/logout'),
};

export const conversationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/conversations', { params }),
  get: (id: string) => api.get(`/conversations/${id}`),
  create: (data: Record<string, unknown>) => api.post('/conversations', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/conversations/${id}`, data),
  resolve: (id: string) => api.patch(`/conversations/${id}/resolve`),
  markRead: (id: string) => api.patch(`/conversations/${id}/read`),
  addNote: (id: string, content: string) => api.post(`/conversations/${id}/notes`, { content }),
};

export const messagesApi = {
  list: (conversationId: string, params?: Record<string, unknown>) =>
    api.get(`/conversations/${conversationId}/messages`, { params }),
  send: (conversationId: string, data: Record<string, unknown>) =>
    api.post(`/conversations/${conversationId}/messages`, data),
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
  sync: () => api.post('/templates/sync'),
};

export const campaignsApi = {
  list: (params?: Record<string, unknown>) => api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: Record<string, unknown>) => api.post('/campaigns', data),
  launch: (id: string) => api.post(`/campaigns/${id}/launch`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
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
};

export const tenantApi = {
  get: () => api.get('/tenant'),
  getStats: () => api.get('/tenant/stats'),
  update: (data: Record<string, unknown>) => api.patch('/tenant', data),
  updateSettings: (data: Record<string, unknown>) => api.patch('/tenant/settings', data),
};

export const usersApi = {
  list: () => api.get('/users'),
  create: (data: Record<string, unknown>) => api.post('/users', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data),
  deactivate: (id: string) => api.delete(`/users/${id}`),
};
