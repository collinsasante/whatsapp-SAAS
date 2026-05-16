import { CallDirection, CallStatus } from './enums';

export interface CallLog {
  id: string;
  tenantId: string;
  contactId: string | null;
  userId: string | null;
  direction: CallDirection;
  status: CallStatus;
  duration: number | null;
  phone: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  isArchived: boolean;
  endReason: string | null;
  recordingUrl: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: { id: string; name: string | null; phone: string; avatarUrl: string | null } | null;
  user?: { id: string; name: string; avatarUrl: string | null } | null;
}
