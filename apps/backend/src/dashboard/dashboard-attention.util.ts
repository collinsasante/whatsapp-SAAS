import type { BacklogSnapshot } from '../analytics/analytics-intelligence.types';
import type { AttentionConversation, AttentionItem, AttentionKind } from './dashboard-command.types';

const HOUR = 3600;

export interface AttentionInput {
  backlog: BacklogSnapshot;
  /** Conversations in REQUESTED status: the customer asked for a person (or the AI handed off) and nobody has taken over. */
  requested: number;
  /** Requested conversations past their reply deadline. Null when the workspace has never set up reply deadlines. */
  slaBreachedRequested: number | null;
  failedDeliveries: { count: number; samples: AttentionConversation[] };
  failedCampaigns: { count: number; names: string[] };
  channelProblems: { count: number; names: string[] };
  days: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

/**
 * Turns the current state of the workspace into the list the owner should act on. Every item carries the count that
 * the linked view will show, and nothing is emitted for a check that found nothing.
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const { backlog } = input;
  const items: AttentionItem[] = [];

  if (input.requested > 0) {
    items.push({
      kind: 'requests', severity: 'warning', count: input.requested,
      title: `${plural(input.requested, 'customer')} waiting for a person`,
      detail: 'They asked for a person, or Verz AI handed the conversation over, and nobody has taken it yet.',
      href: '/inbox?status=REQUESTED', samples: [],
    });
  }

  if (input.slaBreachedRequested != null && input.slaBreachedRequested > 0) {
    items.push({
      kind: 'sla_breached', severity: 'critical', count: input.slaBreachedRequested,
      title: `${plural(input.slaBreachedRequested, 'request')} past the reply deadline`,
      detail: 'These customers asked for a person and the reply deadline for the workspace has passed.',
      href: '/inbox?status=REQUESTED', samples: [],
    });
  }

  if (backlog.unassigned > 0) {
    items.push({
      kind: 'unassigned', severity: 'warning', count: backlog.unassigned,
      title: `${plural(backlog.unassigned, 'open conversation')} with no owner`,
      detail: 'Nobody is assigned, so nobody is responsible for replying.',
      href: '/inbox?status=ACTIVE&assignee=unassigned', samples: [],
    });
  }

  if (backlog.awaitingReply > 0) {
    const oldest = backlog.oldestWaitingSeconds ?? 0;
    const over = backlog.awaitingReplyOverHour;
    items.push({
      kind: 'awaiting_reply',
      severity: oldest >= 4 * HOUR ? 'critical' : over > 0 ? 'warning' : 'info',
      count: backlog.awaitingReply,
      title: `${plural(backlog.awaitingReply, 'customer')} waiting for a reply`,
      detail: over > 0
        ? `${over} ${over === 1 ? 'has' : 'have'} waited more than an hour. The longest wait is ${formatAge(oldest)}.`
        : `The longest wait is ${formatAge(oldest)}.`,
      href: '/inbox?status=UNREPLIED',
      samples: backlog.waiting.map((w) => ({ conversationId: w.conversationId, contactName: w.contactName, ageSeconds: w.waitingSeconds })),
    });
  }

  if (input.failedDeliveries.count > 0) {
    const n = input.failedDeliveries.count;
    items.push({
      kind: 'failed_deliveries', severity: 'warning', count: n,
      title: `${plural(n, 'message')} failed to send`,
      detail: `In the last ${plural(input.days, 'day')}. The customer did not receive these. Open a conversation to see the reason and resend.`,
      href: input.failedDeliveries.samples[0] ? `/inbox?c=${input.failedDeliveries.samples[0].conversationId}` : '/inbox',
      samples: input.failedDeliveries.samples,
    });
  }

  if (input.failedCampaigns.count > 0) {
    const n = input.failedCampaigns.count;
    items.push({
      kind: 'failed_campaigns', severity: 'warning', count: n,
      title: `${plural(n, 'campaign')} failed`,
      detail: input.failedCampaigns.names.slice(0, 3).join(', '),
      href: '/campaigns', samples: [],
    });
  }

  if (input.channelProblems.count > 0) {
    const n = input.channelProblems.count;
    items.push({
      kind: 'channel_problems', severity: 'critical', count: n,
      title: `${plural(n, 'channel')} reporting a problem`,
      detail: `${input.channelProblems.names.slice(0, 3).join(', ')}. Messages may not be arriving or sending.`,
      href: '/channels', samples: [],
    });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const ATTENTION_KINDS: AttentionKind[] = [
  'requests', 'unassigned', 'awaiting_reply', 'sla_breached', 'failed_deliveries', 'failed_campaigns', 'channel_problems',
];
