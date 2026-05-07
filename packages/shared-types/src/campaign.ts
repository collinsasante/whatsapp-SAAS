import { CampaignStatus, RecipientStatus } from './enums';

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  status: CampaignStatus;
  templateId: string;
  templateVariables: Record<string, string> | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  contactId: string;
  status: RecipientStatus;
  messageId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
}
