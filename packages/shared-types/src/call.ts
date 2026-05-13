import { CallDirection, CallStatus } from './enums';

export interface CallLog {
  id: string;
  tenantId: string;
  contactId: string;
  userId: string | null;
  direction: CallDirection;
  status: CallStatus;
  duration: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  user?: { id: string; name: string } | null;
}
