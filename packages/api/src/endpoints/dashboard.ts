import type { AxiosInstance } from 'axios';

export function createDashboardApi(client: AxiosInstance) {
  return {
    overview: () => client.get('/dashboard/overview'),
    teamStats: () => client.get('/dashboard/team'),
    conversationTrend: (days = 30) =>
      client.get('/dashboard/conversation-trend', { params: { days } }),
    conversationStats: (from: string, to: string) =>
      client.get('/dashboard/conversation-stats', { params: { from, to } }),
    whatsappStatus: () => client.get('/dashboard/whatsapp-status'),
  };
}
