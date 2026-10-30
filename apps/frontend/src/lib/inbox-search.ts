/** Shared inbox filter/search helpers (kept pure so list + search results cannot drift apart). */

const SERVER_STATUSES = ['OPEN', 'REQUESTED', 'INTERVENED', 'RESOLVED'] as const;

/** Filter values a link (for example from the dashboard) may pre-select. Anything else is ignored. */
const URL_STATUSES = ['REQUESTED', 'RESOLVED', 'UNREPLIED', 'ACTIVE'];
const URL_CHANNELS = ['WHATSAPP', 'WHATSAPP_WEB', 'FACEBOOK_MESSENGER', 'INSTAGRAM'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the inbox filters from `?status=`, `?assignee=` and `?channel=`. Only whitelisted values are accepted, so a
 * hand-edited address can never put the list into a state the UI has no control for.
 * 'ACTIVE' is every conversation that is not resolved or snoozed, whoever owns it.
 */
export function parseInboxFilterParams(get: (key: string) => string | null): { status: string; member: string; channel: string } {
  const status = get('status') ?? '';
  const assignee = get('assignee') ?? '';
  const channel = get('channel') ?? '';
  return {
    status: URL_STATUSES.includes(status) ? status : 'All',
    member: assignee === 'unassigned' || UUID_RE.test(assignee) ? assignee : 'All',
    channel: URL_CHANNELS.includes(channel) ? channel : 'All',
  };
}

/**
 * 'UNREPLIED' (and 'All') are UI-only tabs, not conversation statuses. Sending them to the API
 * makes the status filter invalid, the request fails, and the search silently shows "no results".
 */
export function serverStatusParam(statusFilter: string): string | undefined {
  return (SERVER_STATUSES as readonly string[]).includes(statusFilter) ? statusFilter : undefined;
}

/** Stable channel id: the stored Channel.type, with the legacy spelling folded in. No type means WhatsApp Cloud. */
export function channelKindOf(channelType: string | null | undefined): string {
  const type = (channelType ?? 'WHATSAPP').toUpperCase();
  return type === 'MESSENGER' ? 'FACEBOOK_MESSENGER' : type;
}

export interface SearchableConversation {
  channel?: { type?: string } | null;
  labels?: string[];
  assignedTo: { id: string } | null;
}

/** Channel / label / explicitly-chosen member filters -- applied to both the list and server search results. */
export function matchesExplicitFilters(
  c: SearchableConversation,
  f: { channelFilter: string; labelFilter: string; memberFilter: string },
): boolean {
  if (f.channelFilter !== 'All' && channelKindOf(c.channel?.type) !== f.channelFilter) return false;
  if (f.labelFilter !== 'All' && !(c.labels ?? []).includes(f.labelFilter)) return false;
  if (f.memberFilter === 'unassigned') return c.assignedTo === null;
  if (f.memberFilter !== 'All') return c.assignedTo?.id === f.memberFilter;
  return true;
}
