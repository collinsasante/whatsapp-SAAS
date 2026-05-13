import { ActivityAction } from './enums';

export interface ActivityLog {
  id: string;
  tenantId: string;
  conversationId: string | null;
  contactId: string | null;
  userId: string | null;
  action: ActivityAction;
  metadata: Record<string, unknown>;
  createdAt: string;
  user?: { id: string; name: string; avatarUrl: string | null } | null;
}
