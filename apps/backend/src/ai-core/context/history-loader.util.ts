import { Prisma } from '@prisma/client';
import { HISTORY_FETCH_BUFFER, SelectedHistory, selectHistory } from './history-select.util';

/** The slice of the Prisma client the loader needs, so tests can run it against a real database or a stub. */
export interface HistoryReader {
  message: {
    findMany(args: {
      where: Prisma.MessageWhereInput;
      orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
      take: number;
      select: { id: true; direction: true; content: true; mediaCaption: true; createdAt: true };
    }): Promise<Array<{ id: string; direction: string; content: string | null; mediaCaption?: string | null; createdAt: Date }>>;
  };
}

/**
 * Loads and selects history for one inbound message. `where` must already be tenant-scoped (buildHistoryWhere /
 * buildConversationHistoryWhere); a null `where` means the caller could not verify the conversation, and the
 * history is then empty rather than an unscoped query.
 */
export async function loadHistory(
  prisma: HistoryReader,
  where: Prisma.MessageWhereInput | null,
  windowSize: number,
  currentMessageId?: string,
): Promise<SelectedHistory> {
  if (!where) return { turns: [], customerMessages: [], lastOutbound: null };
  const rows = await prisma.message.findMany({
    where,
    // The id breaks ties between rows stored in the same millisecond, so the order is always the same.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: windowSize + HISTORY_FETCH_BUFFER,
    select: { id: true, direction: true, content: true, mediaCaption: true, createdAt: true },
  });
  // The where clause admits a caption-only row (no body) only for inbound IMAGE/VIDEO, so the caption is the customer's own text.
  const withText = rows.map(({ id, direction, content, mediaCaption, createdAt }) => ({ id, direction, content: content ?? mediaCaption ?? null, createdAt }));
  return selectHistory(withText, currentMessageId, windowSize);
}
