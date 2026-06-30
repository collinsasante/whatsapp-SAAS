import type { AxiosInstance } from 'axios';

export function createCampaignsApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/campaigns', { params }),
    get: (id: string) => client.get(`/campaigns/${id}`),
    create: (data: Record<string, unknown>) => client.post('/campaigns', data),
    launch: (id: string) => client.post(`/campaigns/${id}/launch`),
    pause: (id: string) => client.post(`/campaigns/${id}/pause`),
    resume: (id: string) => client.post(`/campaigns/${id}/resume`),
    delete: (id: string) => client.delete(`/campaigns/${id}`),
    estimateRecipients: (data: {
      segmentId?: string;
      labels?: string[];
      phones?: string[];
    }) => client.post('/campaigns/estimate-recipients', data),
    getRecipients: (id: string, params?: Record<string, unknown>) =>
      client.get(`/campaigns/${id}/recipients`, { params }),
  };
}
