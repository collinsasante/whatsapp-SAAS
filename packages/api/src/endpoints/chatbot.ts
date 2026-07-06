import type { AxiosInstance } from 'axios';

export function createChatbotFlowsApi(client: AxiosInstance) {
  return {
    list: () => client.get('/chatbot-flows'),
    get: (id: string) => client.get(`/chatbot-flows/${id}`),
    create: (data: Record<string, unknown>) => client.post('/chatbot-flows', data),
    update: (id: string, data: Record<string, unknown>) => client.patch(`/chatbot-flows/${id}`, data),
    delete: (id: string) => client.delete(`/chatbot-flows/${id}`),
  };
}
