import type { AxiosInstance } from 'axios';

export function createCallsApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/calls', { params }),
    get: (id: string) => client.get(`/calls/${id}`),
    create: (data: Record<string, unknown>) => client.post('/calls', data),
    update: (id: string, data: Record<string, unknown>) => client.patch(`/calls/${id}`, data),
    stats: () => client.get('/calls/stats'),
    analytics: (params?: Record<string, unknown>) => client.get('/calls/analytics', { params }),
    addNote: (id: string, content: string) => client.post(`/calls/${id}/notes`, { content }),
    archive: (id: string) => client.patch(`/calls/${id}/archive`),
    delete: (id: string) => client.delete(`/calls/${id}`),
    generateLink: () => client.post('/calls/links/generate'),
    transfer: (id: string, toUserId: string, reason?: string, transferType?: string) =>
      client.post(`/calls/${id}/transfer`, { toUserId, reason, transferType }),
    // Live-call signaling -- mirrors apps/frontend/src/lib/api.ts's callsApi exactly.
    mute: (id: string, muted: boolean) => client.patch(`/calls/${id}/mute`, { muted }),
    hold: (id: string, held: boolean) => client.patch(`/calls/${id}/hold`, { held }),
    initiate: (data: { phone: string; contactId?: string; type?: 'audio' | 'video'; sdpOffer?: string }) =>
      client.post('/calls/initiate', data),
    respond: (id: string, action: 'pre_accept' | 'accept' | 'reject' | 'terminate', sdpAnswer?: string) =>
      client.post(`/calls/${id}/respond`, { action, sdpAnswer }),
    getPermission: (phone: string) => client.get('/calls/permissions', { params: { phone } }),
    requestPermission: (phone: string) => client.post('/calls/permissions/request', { phone }),
  };
}
