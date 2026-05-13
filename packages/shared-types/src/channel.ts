import { ChannelType } from './enums';

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  isActive: boolean;
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
