import type { AxiosInstance } from 'axios';

export function createChannelsApi(client: AxiosInstance) {
  return {
    list: () => client.get('/channels'),
    get: (id: string) => client.get(`/channels/${id}`),
    create: (data: Record<string, unknown>) => client.post('/channels', data),
    update: (id: string, data: Record<string, unknown>) => client.patch(`/channels/${id}`, data),
    toggle: (id: string) => client.patch(`/channels/${id}/toggle`),
    delete: (id: string) => client.delete(`/channels/${id}`),
  };
}
