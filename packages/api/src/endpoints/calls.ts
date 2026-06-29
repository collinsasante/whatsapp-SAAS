import type { AxiosInstance } from 'axios';

export function createCallsApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/calls', { params }),
    get: (id: string) => client.get(`/calls/${id}`),
    stats: () => client.get('/calls/stats'),
    analytics: (params?: Record<string, unknown>) => client.get('/calls/analytics', { params }),
    addNote: (id: string, content: string) => client.post(`/calls/${id}/notes`, { content }),
    archive: (id: string) => client.patch(`/calls/${id}/archive`),
    delete: (id: string) => client.delete(`/calls/${id}`),
    generateLink: () => client.post('/calls/links/generate'),
    transfer: (id: string, toUserId: string, reason?: string, transferType?: string) =>
      client.post(`/calls/${id}/transfer`, { toUserId, reason, transferType }),
  };
}
