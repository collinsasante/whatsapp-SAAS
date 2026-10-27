/**
 * Picks the conversation history a generator should show the model for ONE inbound message.
 *
 * The old code assumed the newest stored row was the message being answered and dropped it with
 * `slice(0, -1)`. That is only true when the customer sends one message and waits. With quick
 * fragments ("Hi" / "I want shea butter" / "how much is 500g?"), or a welcome message stored just after
 * the inbound, the newest row is something else: the model then saw the answered message twice and lost
 * its own latest reply.
 *
 * Rules, keyed on the unique id of the message being answered:
 *  - the message itself is never part of the history (the caller adds it as the final turn);
 *  - customer messages that arrived AFTER it (by the query's own ordering) are left out. They have not been answered yet and each gets its
 *    own turn, in order, behind the per-conversation lock, so showing them early would answer them twice;
 *  - everything else, including the assistant's and agents' replies stored after it, is kept in time order.
 *
 * Without an id (callers with no stored inbound row, such as the test sandbox) the old rule is kept exactly.
 */

export interface HistoryRow {
  id: string;
  direction: string;
  content: string | null;
  createdAt: Date;
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SelectedHistory {
  /** Oldest first, ready to send to the model. */
  turns: HistoryTurn[];
  /** The customer's earlier messages, oldest first, for follow-up context in knowledge-base retrieval. */
  customerMessages: string[];
  /** The newest assistant or agent text in the selected history, for menu-digit expansion. */
  lastOutbound: string | null;
}

/** Extra rows fetched beyond the window, so dropping the current message and later fragments still leaves a full window. */
export const HISTORY_FETCH_BUFFER = 25;

/** @param rowsNewestFirst the query result, newest first */
export function selectHistory(rowsNewestFirst: HistoryRow[], currentMessageId: string | undefined, windowSize: number): SelectedHistory {
  let kept: HistoryRow[];
  if (currentMessageId === undefined) {
    kept = rowsNewestFirst.slice(1);
  } else {
    const at = rowsNewestFirst.findIndex((r) => r.id === currentMessageId);
    if (at === -1) {
      kept = rowsNewestFirst;
    } else {
      // The query orders rows by (createdAt, id) newest first, so every row before `at` is newer than the current
      // message, including one stored in the same millisecond. Following that order, not timestamps alone, keeps two
      // messages stored at the same instant from appearing in each other's context.
      kept = rowsNewestFirst.filter((r, i) => i !== at && !(i < at && r.direction === 'INBOUND'));
    }
  }

  const chronological = kept.slice(0, windowSize).reverse().filter((r): r is HistoryRow & { content: string } => r.content != null);
  return {
    turns: chronological.map((r) => ({ role: r.direction === 'INBOUND' ? 'user' : 'assistant', content: r.content })),
    customerMessages: chronological.filter((r) => r.direction === 'INBOUND').map((r) => r.content),
    lastOutbound: [...chronological].reverse().find((r) => r.direction !== 'INBOUND')?.content ?? null,
  };
}
