import type { AxiosInstance } from 'axios';

export function createWorkspaceApi(client: AxiosInstance) {
  return {
    listMembers: () => client.get('/workspace/members'),
    invite: (email: string, role?: string, name?: string) =>
      client.post('/workspace/invite', { email, role, name }),
    listInvitations: () => client.get('/workspace/invitations'),
    cancelInvitation: (id: string) => client.delete(`/workspace/invitations/${id}`),
    editMember: (id: string, data: Record<string, unknown>) =>
      client.patch(`/workspace/members/${id}`, data),
    suspendMember: (id: string) => client.patch(`/workspace/members/${id}/suspend`),
    reactivateMember: (id: string) => client.patch(`/workspace/members/${id}/reactivate`),
    removeMember: (id: string, reassignToId?: string) =>
      client.delete(`/workspace/members/${id}`, { data: { reassignToId } }),
    getMemberActivity: (id: string) => client.get(`/workspace/members/${id}/activity`),
  };
}

export function createTenantApi(client: AxiosInstance) {
  return {
    get: () => client.get('/tenant'),
    getStats: () => client.get('/tenant/stats'),
    update: (data: Record<string, unknown>) => client.patch('/tenant', data),
    updateSettings: (data: Record<string, unknown>) => client.patch('/tenant/settings', data),
  };
}
