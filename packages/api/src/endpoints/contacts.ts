import type { AxiosInstance } from 'axios';

export function createContactsApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/contacts', { params }),
    get: (id: string) => client.get(`/contacts/${id}`),
    create: (data: Record<string, unknown>) => client.post('/contacts', data),
    update: (id: string, data: Record<string, unknown>) =>
      client.patch(`/contacts/${id}`, data),
    delete: (id: string) => client.delete(`/contacts/${id}`),
    import: (contacts: unknown[]) => client.post('/contacts/import', { contacts }),
    block: (id: string) => client.patch(`/contacts/${id}/block`),
  };
}
