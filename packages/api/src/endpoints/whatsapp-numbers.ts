import type { AxiosInstance } from 'axios';

export interface WhatsAppNumberCredentials {
  label?: string;
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
}

export function createWhatsAppNumbersApi(client: AxiosInstance) {
  return {
    list: () => client.get('/whatsapp-numbers'),
    create: (data: Required<WhatsAppNumberCredentials> & { isDefault?: boolean }) => client.post('/whatsapp-numbers', data),
    update: (id: string, data: WhatsAppNumberCredentials & { isActive?: boolean }) => client.patch(`/whatsapp-numbers/${id}`, data),
    setDefault: (id: string) => client.patch(`/whatsapp-numbers/${id}/set-default`),
    delete: (id: string) => client.delete(`/whatsapp-numbers/${id}`),
    reconnect: (id: string, data?: WhatsAppNumberCredentials) => client.patch(`/whatsapp-numbers/${id}/reconnect`, data ?? {}),
    testConnection: (id: string) => client.post(`/whatsapp-numbers/${id}/test-connection`),
  };
}
