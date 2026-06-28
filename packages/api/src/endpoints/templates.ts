import type { AxiosInstance } from 'axios';

export function createTemplatesApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/templates', { params }),
    get: (id: string) => client.get(`/templates/${id}`),
    create: (data: Record<string, unknown>) => client.post('/templates', data),
    update: (id: string, data: Record<string, unknown>) =>
      client.patch(`/templates/${id}`, data),
    delete: (id: string) => client.delete(`/templates/${id}`),
    submit: (id: string) => client.post(`/templates/${id}/submit`),
    sync: () => client.post('/templates/sync'),
  };
}
