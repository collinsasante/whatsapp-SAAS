export * from './types';
export * from './client';
export * from './endpoints/auth';
export * from './endpoints/inbox';
export * from './endpoints/contacts';
export * from './endpoints/campaigns';
export * from './endpoints/dashboard';
export * from './endpoints/notifications';
export * from './endpoints/media';
export * from './endpoints/templates';
export * from './endpoints/workspace';
export * from './endpoints/ai';
export * from './endpoints/channels';
export * from './endpoints/calls';
export * from './endpoints/automation';
export * from './endpoints/chatbot';
export * from './endpoints/billing';
export * from './endpoints/manageSettings';

import type { AxiosInstance } from 'axios';
import type { ApiClientConfig } from './types';
import { createApiClient } from './client';
import { createAuthApi } from './endpoints/auth';
import { createConversationsApi, createMessagesApi } from './endpoints/inbox';
import { createContactsApi } from './endpoints/contacts';
import { createCampaignsApi } from './endpoints/campaigns';
import { createDashboardApi } from './endpoints/dashboard';
import { createNotificationsApi } from './endpoints/notifications';
import { createMediaApi } from './endpoints/media';
import { createTemplatesApi } from './endpoints/templates';
import { createWorkspaceApi, createTenantApi } from './endpoints/workspace';
import { createAiApi, createKnowledgeBaseApi } from './endpoints/ai';
import { createChannelsApi } from './endpoints/channels';
import { createCallsApi } from './endpoints/calls';
import { createAutomationApi } from './endpoints/automation';
import { createChatbotFlowsApi } from './endpoints/chatbot';
import { createBillingApi } from './endpoints/billing';
import { createManageSettingsApi } from './endpoints/manageSettings';

export interface VerzChatApiClient {
  http: AxiosInstance;
  auth: ReturnType<typeof createAuthApi>;
  conversations: ReturnType<typeof createConversationsApi>;
  messages: ReturnType<typeof createMessagesApi>;
  contacts: ReturnType<typeof createContactsApi>;
  campaigns: ReturnType<typeof createCampaignsApi>;
  dashboard: ReturnType<typeof createDashboardApi>;
  notifications: ReturnType<typeof createNotificationsApi>;
  media: ReturnType<typeof createMediaApi>;
  templates: ReturnType<typeof createTemplatesApi>;
  workspace: ReturnType<typeof createWorkspaceApi>;
  tenant: ReturnType<typeof createTenantApi>;
  ai: ReturnType<typeof createAiApi>;
  knowledgeBase: ReturnType<typeof createKnowledgeBaseApi>;
  channels: ReturnType<typeof createChannelsApi>;
  calls: ReturnType<typeof createCallsApi>;
  automation: ReturnType<typeof createAutomationApi>;
  chatbotFlows: ReturnType<typeof createChatbotFlowsApi>;
  billing: ReturnType<typeof createBillingApi>;
  manageSettings: ReturnType<typeof createManageSettingsApi>;
}

export function createVerzChatApi(config: ApiClientConfig): VerzChatApiClient {
  const http = createApiClient(config);
  return {
    http,
    auth: createAuthApi(http),
    conversations: createConversationsApi(http),
    messages: createMessagesApi(http),
    contacts: createContactsApi(http),
    campaigns: createCampaignsApi(http),
    dashboard: createDashboardApi(http),
    notifications: createNotificationsApi(http),
    media: createMediaApi(http),
    templates: createTemplatesApi(http),
    workspace: createWorkspaceApi(http),
    tenant: createTenantApi(http),
    ai: createAiApi(http),
    knowledgeBase: createKnowledgeBaseApi(http),
    channels: createChannelsApi(http),
    calls: createCallsApi(http),
    automation: createAutomationApi(http),
    chatbotFlows: createChatbotFlowsApi(http),
    billing: createBillingApi(http),
    manageSettings: createManageSettingsApi(http),
  };
}
