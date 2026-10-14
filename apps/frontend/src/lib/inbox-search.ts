/** Shared inbox filter/search helpers (kept pure so list + search results cannot drift apart). */

const SERVER_STATUSES = ['OPEN', 'REQUESTED', 'INTERVENED', 'RESOLVED'] as const;

/**
 * 'UNREPLIED' (and 'All') are UI-only tabs, not conversation statuses. Sending them to the API
 * makes the status filter invalid, the request fails, and the search silently shows "no results".
 */
export function serverStatusParam(statusFilter: string): string | undefined {
  return (SERVER_STATUSES as readonly string[]).includes(statusFilter) ? statusFilter : undefined;
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
  const channel = c.channel?.type?.toUpperCase() ?? 'WHATSAPP';
  if (f.channelFilter !== 'All' && channel !== f.channelFilter) return false;
  if (f.labelFilter !== 'All' && !(c.labels ?? []).includes(f.labelFilter)) return false;
  if (f.memberFilter === 'unassigned') return c.assignedTo === null;
  if (f.memberFilter !== 'All') return c.assignedTo?.id === f.memberFilter;
  return true;
}
