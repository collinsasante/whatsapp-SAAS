import type { AxiosInstance } from 'axios';

export function createAutomationApi(client: AxiosInstance) {
  return {
    list: () => client.get('/automation'),
    get: (id: string) => client.get(`/automation/${id}`),
    create: (data: Record<string, unknown>) => client.post('/automation', data),
    update: (id: string, data: Record<string, unknown>) => client.patch(`/automation/${id}`, data),
    delete: (id: string) => client.delete(`/automation/${id}`),
  };
}
