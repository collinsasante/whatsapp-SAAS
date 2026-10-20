/**
 * The Resolved and Requests tabs show a list fetched once when the tab is opened. Realtime events only reach
 * the live store, so those tabs never showed a new customer message (no unread badge, no new preview, and a
 * chat that had since been reopened still sat in the Resolved list). This overlays the live store on top of the
 * fetched list so both agree.
 */
export interface MergeableConversation {
  id: string;
  status: string;
  priority?: number;
  lastMessageAt?: string | Date | null;
}

const time = (v: string | Date | null | undefined): number => (v ? new Date(v).getTime() || 0 : 0);

/** Live values win, but a field the live row simply does not have (undefined) never erases a fetched one. */
function mergeRow<T extends object>(fetched: T, live: T): T {
  const definedLive = Object.fromEntries(Object.entries(live).filter(([, v]) => v !== undefined));
  return { ...fetched, ...definedLive } as T;
}

/**
 * @param snapshot rows fetched for the tab (may be stale)
 * @param live     rows currently in the realtime store (fresher where present)
 * @param status   the status this tab shows
 *
 * - a snapshot row that exists live takes the live values (fresh unread count, preview, status);
 * - a row whose live status no longer matches the tab (e.g. reopened by a customer reply) leaves the tab;
 * - a live row that matches the tab but was not fetched (e.g. just resolved by a teammate) joins it.
 */
export function overlayLiveConversations<T extends MergeableConversation>(snapshot: T[], live: T[], status: string): T[] {
  const liveById = new Map(live.map((c) => [c.id, c]));
  const merged = new Map<string, T>();
  for (const row of snapshot) {
    const fresh = liveById.get(row.id);
    merged.set(row.id, fresh ? mergeRow(row, fresh) : row);
  }
  for (const row of live) if (row.status === status && !merged.has(row.id)) merged.set(row.id, row);

  return [...merged.values()]
    .filter((c) => c.status === status)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || time(b.lastMessageAt) - time(a.lastMessageAt));
}
