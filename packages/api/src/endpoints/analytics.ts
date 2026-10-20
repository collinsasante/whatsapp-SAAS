import type { AxiosInstance } from 'axios';

export interface DateRangeParams {
  from?: string;
  to?: string;
}

export interface AnalyticsOverview {
  from: string;
  to: string;
  scope: 'tenant' | 'agent';
  conversations: { total: number; new: number; returning: number; changePct: number | null };
  resolved: { count: number; rate: number | null; changePct: number | null };
  openWorkload: { count: number };
  customers: { new: number; newChangePct: number | null; active: number; activeChangePct: number | null };
  messages: {
    sent: number; delivered: number; read: number; replied: number;
    deliveryRate: number; readRate: number; replyRate: number;
  };
  medianFirstResponseSeconds: number | null;
  calls: { total: number; answered: number; missed: number; changePct: number | null };
  csat: { average: number | null; responses: number; changePct: number | null };
  revenue: { amount: number; currency: string; successCount: number; failedCount: number } | null;
}

export interface AnalyticsConversationsSeries {
  from: string;
  to: string;
  granularity: 'day' | 'hour';
  scope: 'tenant' | 'agent';
  series: Array<{ date: string; new: number; returning: number; opened: number; resolved: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byTag: Array<{ tag: string; count: number }>;
  busiestHours: Array<{ dayOfWeek: number; hour: number; count: number }>;
}

export interface AnalyticsAgentRow {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  conversationsHandled: number;
  resolvedCount: number;
  medianFirstResponseSeconds: number | null;
  medianResolutionSeconds: number | null;
}

export interface AnalyticsAgentPerformance {
  from: string;
  to: string;
  agents: AnalyticsAgentRow[];
  teamAverage: {
    conversationsHandled: number;
    resolvedCount: number;
    medianFirstResponseSeconds: number;
    medianResolutionSeconds: number;
  };
}

export function createAnalyticsApi(client: AxiosInstance) {
  return {
    overview: (params?: DateRangeParams) =>
      client.get<AnalyticsOverview>('/analytics/overview', { params }),
    conversations: (params?: DateRangeParams & { granularity?: 'day' | 'hour' }) =>
      client.get<AnalyticsConversationsSeries>('/analytics/conversations', { params }),
    agents: (params?: DateRangeParams) =>
      client.get<AnalyticsAgentPerformance>('/analytics/agents', { params }),
    campaigns: (params?: DateRangeParams & { limit?: number; offset?: number }) =>
      client.get('/analytics/campaigns', { params }),
    health: () => client.get('/analytics/health'),
    revenue: (params?: DateRangeParams) => client.get('/analytics/revenue', { params }),
  };
}
