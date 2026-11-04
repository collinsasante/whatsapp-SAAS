import { Prisma } from '@prisma/client';
import { HISTORY_FETCH_BUFFER, SelectedHistory, selectHistory } from './history-select.util';
import { labelForAi } from '../../message-enrichment/enrichment-labels';

type EnrichmentRow = { kind: string; text: string | null };
type HistoryDbRow = {
  id: string; direction: string; content: string | null; mediaCaption?: string | null; createdAt: Date;
  /** Completed machine transcripts / descriptions for this message (absent in simple stubs). */
  enrichments?: EnrichmentRow[];
  /** The owning workspace's opt-ins, so generated text is used only while the feature is on. */
  tenant?: { settings?: { voiceTranscriptionEnabled?: boolean; imageUnderstandingEnabled?: boolean } | null } | null;
};

/** The slice of the Prisma client the loader needs, so tests can run it against a real database or a stub. */
export interface HistoryReader {
  message: {
    findMany(args: {
      where: Prisma.MessageWhereInput;
      orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
      take: number;
      select: {
        id: true; direction: true; content: true; mediaCaption: true; createdAt: true;
        enrichments: { where: { status: 'COMPLETED'; text: { not: string } }; select: { kind: true; text: true } };
        tenant: { select: { settings: { select: { voiceTranscriptionEnabled: true; imageUnderstandingEnabled: true } } } };
      };
    }): Promise<HistoryDbRow[]>;
  };
}

/** The customer's own words first, then any generated transcript or description, labelled as such. */
function composeContent(row: HistoryDbRow): string | null {
  const s = row.tenant?.settings;
  const generated = (row.enrichments ?? [])
    .filter((e) => e.text && ((e.kind === 'TRANSCRIPT' && s?.voiceTranscriptionEnabled) || (e.kind === 'IMAGE_ANALYSIS' && s?.imageUnderstandingEnabled)))
    .map((e) => labelForAi(e.kind, e.text as string));
  // The where clause admits a caption-only row (no body) only for inbound IMAGE/VIDEO, so the caption is the customer's own text.
  const own = row.content ?? row.mediaCaption ?? null;
  const parts = [own, ...generated].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join('\n') : null;
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
    select: {
      id: true, direction: true, content: true, mediaCaption: true, createdAt: true,
      enrichments: { where: { status: 'COMPLETED', text: { not: '' } }, select: { kind: true, text: true } },
      tenant: { select: { settings: { select: { voiceTranscriptionEnabled: true, imageUnderstandingEnabled: true } } } },
    },
  });
  const withText = rows.map((r) => ({ id: r.id, direction: r.direction, content: composeContent(r), createdAt: r.createdAt }));
  return selectHistory(withText, currentMessageId, windowSize);
}
