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

export function createAiExecutionsApi(client: AxiosInstance) {
  return {
    list: (params?: { conversationId?: string; status?: string; cursor?: string; limit?: number }) =>
      client.get('/ai/executions', { params }),
    get: (id: string) => client.get(`/ai/executions/${id}`),
  };
}

export function createAiLearningApi(client: AxiosInstance) {
  return {
    overview: (hours?: number) => client.get('/ai-learning/overview', { params: { hours } }),
    listInteractions: (params?: { status?: string; severity?: string; needsHumanReview?: boolean; cursor?: string; limit?: number }) =>
      client.get('/ai-learning/interactions', { params }),
    getInteraction: (id: string) => client.get(`/ai-learning/interactions/${id}`),
    submitFeedback: (id: string, data: { rating: 'GOOD' | 'BAD'; reason?: string; notes?: string; expectedAction?: string; expectedResponse?: string }) =>
      client.post(`/ai-learning/interactions/${id}/feedback`, data),
  };
}
