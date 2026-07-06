export interface CampaignSendJob {
  campaignId: string;
  tenantId: string;
  batchIndex: number;
  recipientIds: string[];
}

export interface MessageRetryJob {
  messageId: string;
  tenantId: string;
  attempt: number;
}

export interface AutomationTriggerJob {
  tenantId: string;
  ruleId: string;
  conversationId: string;
  contactId: string;
  triggerData: Record<string, unknown>;
}

export interface ScheduledCampaignJob {
  campaignId: string;
  tenantId: string;
}

export interface CsatSurveyJob {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
}

export interface SnoozeWakeJob {
  conversationId: string;
  tenantId: string;
}

export interface AiTrialExpireJob {
  tenantId: string;
}

export enum QueueName {
  CAMPAIGN_SEND = 'campaign-send',
  MESSAGE_RETRY = 'message-retry',
  AUTOMATION_TRIGGER = 'automation-trigger',
  SCHEDULED_CAMPAIGN = 'scheduled-campaign',
  WEBHOOK_PROCESS = 'webhook-process',
  CSAT_SURVEY = 'csat-survey',
  SNOOZE = 'snooze',
  AI_TRIAL = 'ai-trial',
  SLA_MONITOR = 'sla-monitor',
  ANALYTICS_ROLLUP = 'analytics-rollup',
  WHATSAPP_QUALITY_SYNC = 'whatsapp-quality-sync',
}
