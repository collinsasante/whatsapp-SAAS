import type { AxiosInstance } from 'axios';

export function createAiApi(client: AxiosInstance) {
  return {
    analytics: (from?: string, to?: string) =>
      client.get('/ai-logs/analytics', { params: { from, to } }),
    byConversation: (conversationId: string) =>
      client.get(`/ai-logs/${conversationId}`),
    updateStatus: (id: string, status: string, finalSentMessage?: string) =>
      client.patch(`/ai-logs/${id}/status`, { status, finalSentMessage }),
    feedback: (id: string, rating: number, label?: string, note?: string) =>
      client.patch(`/ai-logs/${id}/feedback`, { rating, label, note }),
    test: (message: string) => client.post('/ai-logs/test', { message }),
  };
}

export function createKnowledgeBaseApi(client: AxiosInstance) {
  return {
    list: () => client.get('/knowledge-base'),
    create: (data: { title: string; content: string; isActive?: boolean }) =>
      client.post('/knowledge-base', data),
    update: (id: string, data: { title?: string; content?: string; isActive?: boolean }) =>
      client.patch(`/knowledge-base/${id}`, data),
    delete: (id: string) => client.delete(`/knowledge-base/${id}`),
    learn: () => client.post('/knowledge-base/learn'),
    scrape: (url: string) => client.post('/knowledge-base/scrape', { url }),
  };
}
