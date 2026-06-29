import type { AxiosInstance } from 'axios';

export function createManageSettingsApi(client: AxiosInstance) {
  return {
    get: () => client.get('/manage/settings'),
    updateAi: (data: {
      aiEnabled?: boolean;
      aiAlwaysOn?: boolean;
      aiPersonality?: string;
      aiMode?: string;
      aiPilotGroup?: boolean;
    }) => client.patch('/manage/settings/ai', data),
    approveAi: () => client.post('/manage/settings/ai/approve', {}),
    updateWelcome: (data: { welcomeEnabled?: boolean; welcomeMessage?: string }) =>
      client.patch('/manage/settings/welcome', data),
    updateOffHours: (data: Record<string, unknown>) =>
      client.patch('/manage/settings/off-hours', data),
  };
}
