import type { AxiosInstance } from 'axios';

export function createNotificationsApi(client: AxiosInstance) {
  return {
    list: (limit = 30) => client.get('/notifications', { params: { limit } }),
    unreadCount: () => client.get('/notifications/unread-count'),
    markRead: (id: string) => client.patch(`/notifications/${id}/read`),
    markAllRead: () => client.patch('/notifications/read-all'),
  };
}
