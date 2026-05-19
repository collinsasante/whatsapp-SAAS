export interface Tenant {
  id: string;
  name: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  accessToken: string | null;
  webhookVerifyToken: string;
  plan: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  id: string;
  tenantId: string;
  businessName: string | null;
  businessEmail: string | null;
  timezone: string;
  autoReply: boolean;
  autoReplyMessage: string | null;
  maxAgents: number;
  updatedAt: Date;
}
