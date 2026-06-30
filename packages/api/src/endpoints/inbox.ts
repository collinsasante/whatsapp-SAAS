import type { AxiosInstance } from 'axios';

export function createConversationsApi(client: AxiosInstance) {
  return {
    list: (params?: Record<string, unknown>) => client.get('/conversations', { params }),
    get: (id: string) => client.get(`/conversations/${id}`),
    create: (data: Record<string, unknown>) => client.post('/conversations', data),
    findOrCreate: (contactId: string) =>
      client.post('/conversations/find-or-create', { contactId }),
    update: (id: string, data: Record<string, unknown>) =>
      client.patch(`/conversations/${id}`, data),
    resolve: (id: string) => client.patch(`/conversations/${id}/resolve`),
    archive: (id: string) => client.patch(`/conversations/${id}`, { status: 'ARCHIVED' }),
    delete: (id: string) => client.delete(`/conversations/${id}`),
    markRead: (id: string) => client.patch(`/conversations/${id}/read`),
    markUnread: (id: string) => client.patch(`/conversations/${id}/mark-unread`),
    takeover: (id: string) => client.post(`/conversations/${id}/takeover`),
    addNote: (id: string, content: string) =>
      client.post(`/conversations/${id}/notes`, { content }),
    getNotes: (id: string) => client.get(`/conversations/${id}/notes`),
    editNote: (id: string, noteId: string, content: string) =>
      client.patch(`/conversations/${id}/notes/${noteId}`, { content }),
    deleteNote: (id: string, noteId: string) =>
      client.delete(`/conversations/${id}/notes/${noteId}`),
    request: (id: string, reason?: string) =>
      client.post(`/conversations/${id}/request`, { reason }),
    intervene: (id: string) => client.post(`/conversations/${id}/intervene`),
    reopen: (id: string) => client.post(`/conversations/${id}/reopen`),
    transfer: (id: string, toAgentId: string, reason?: string) =>
      client.post(`/conversations/${id}/transfer`, { toAgentId, reason }),
    getCounts: () => client.get('/conversations/counts'),
    getEvents: (id: string) => client.get(`/conversations/${id}/events`),
    summarize: (id: string) => client.post(`/conversations/${id}/summarize`),
  };
}

export function createMessagesApi(client: AxiosInstance) {
  return {
    list: (conversationId: string, params?: Record<string, unknown>) =>
      client.get(`/conversations/${conversationId}/messages`, { params }),
    send: (conversationId: string, data: Record<string, unknown>) =>
      client.post(`/conversations/${conversationId}/messages`, data),
    react: (conversationId: string, messageId: string, emoji: string) =>
      client.post(`/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),
    removeReact: (conversationId: string, messageId: string, emoji: string) =>
      client.delete(`/conversations/${conversationId}/messages/${messageId}/react`, {
        data: { emoji },
      }),
    star: (conversationId: string, messageId: string) =>
      client.patch(`/conversations/${conversationId}/messages/${messageId}/star`),
    pin: (conversationId: string, messageId: string) =>
      client.patch(`/conversations/${conversationId}/messages/${messageId}/pin`),
  };
}
