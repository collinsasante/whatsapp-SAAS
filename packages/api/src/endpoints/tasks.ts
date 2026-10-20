import type { AxiosInstance } from 'axios';

export function createInternalTasksApi(client: AxiosInstance) {
  return {
    list: (params?: { status?: string; department?: string; assigneeId?: string }) =>
      client.get('/internal-tasks', { params }),
    get: (id: string) => client.get(`/internal-tasks/${id}`),
    updateStatus: (id: string, status: string) => client.patch(`/internal-tasks/${id}/status`, { status }),
    assign: (id: string, assigneeId: string) => client.patch(`/internal-tasks/${id}/assign`, { assigneeId }),
  };
}
