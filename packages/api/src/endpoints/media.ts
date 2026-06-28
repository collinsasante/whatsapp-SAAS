import type { AxiosInstance } from 'axios';

export function createMediaApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/media', { params }),
    library: (params?: Record<string, unknown>) => client.get('/media/library', { params }),
    deleteAsset: (id: string) => client.delete(`/media/${id}`),
    deduplicate: () => client.post('/media/deduplicate'),
  };
}
