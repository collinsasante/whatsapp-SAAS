import { HistoryRow, selectHistory } from './history-select.util';

const row = (id: string, direction: 'INBOUND' | 'OUTBOUND', content: string | null, sec: number): HistoryRow => ({ id, direction, content, createdAt: new Date(sec * 1000) });
/** The loader returns rows newest first. */
const newestFirst = (...rows: HistoryRow[]) => [...rows].reverse();

describe('selectHistory', () => {
  it('drops the message being answered by id, wherever it sits', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'OUTBOUND', 'Hello', 2), row('c', 'INBOUND', 'price?', 3));
    expect(selectHistory(rows, 'c', 50).turns).toEqual([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]);
  });

  it('keeps the assistant\'s latest reply even when it was stored after the message being answered', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'INBOUND', 'price?', 2), row('r', 'OUTBOUND', 'Hello', 3));
    const out = selectHistory(rows, 'b', 50);
    expect(out.turns.map((t) => t.content)).toEqual(['Hi', 'Hello']);
  });

  it('leaves out customer messages that arrived later: they have not been answered yet', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'INBOUND', 'I want shea butter', 2), row('c', 'INBOUND', 'how much?', 3));
    expect(selectHistory(rows, 'a', 50).turns).toEqual([]);
    expect(selectHistory(rows, 'b', 50).turns.map((t) => t.content)).toEqual(['Hi']);
  });

  it('shows the message once: it is never both in the history and the final turn', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'INBOUND', 'price?', 2), row('r1', 'OUTBOUND', 'x', 3), row('r2', 'OUTBOUND', 'y', 4));
    expect(selectHistory(rows, 'b', 50).turns.map((t) => t.content)).not.toContain('price?');
  });

  it('follows the query order for rows with equal timestamps (the loader breaks ties by id)', () => {
    // Sorted (createdAt desc, id desc): b first, then a. So b is "newer" than a even with the same createdAt.
    const rows = [row('b', 'INBOUND', 'second', 5), row('a', 'INBOUND', 'first', 5)];
    expect(selectHistory(rows, 'a', 50).turns.map((t) => t.content)).toEqual([]);
    expect(selectHistory(rows, 'b', 50).turns.map((t) => t.content)).toEqual(['first']);
  });

  it('keeps the old rule exactly when no id is given: the newest row is assumed to be the current message', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'OUTBOUND', 'Hello', 2), row('c', 'INBOUND', 'price?', 3));
    expect(selectHistory(rows, undefined, 50).turns.map((t) => t.content)).toEqual(['Hi', 'Hello']);
  });

  it('uses everything fetched when the id is not among the rows, rather than guessing which to drop', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'Hi', 1), row('b', 'OUTBOUND', 'Hello', 2));
    expect(selectHistory(rows, 'not-there', 50).turns.map((t) => t.content)).toEqual(['Hi', 'Hello']);
  });

  it('applies the window after dropping rows, keeping the most recent ones in order', () => {
    const rows = newestFirst(...Array.from({ length: 10 }, (_, i) => row(`m${i}`, i % 2 ? 'OUTBOUND' : 'INBOUND', `t${i}`, i)));
    expect(selectHistory(rows, 'm9', 3).turns.map((t) => t.content)).toEqual(['t6', 't7', 't8']);
  });

  it('skips rows without text', () => {
    const rows = newestFirst(row('a', 'INBOUND', null, 1), row('b', 'INBOUND', 'Hi', 2), row('c', 'INBOUND', 'price?', 3));
    expect(selectHistory(rows, 'c', 50).turns.map((t) => t.content)).toEqual(['Hi']);
  });

  it('reports the customer\'s earlier messages and the last outbound text for follow-ups and menu expansion', () => {
    const rows = newestFirst(row('a', 'INBOUND', 'I want shea butter', 1), row('b', 'OUTBOUND', '1. 250g\n2. 500g', 2), row('c', 'INBOUND', '2', 3));
    const out = selectHistory(rows, 'c', 50);
    expect(out.customerMessages).toEqual(['I want shea butter']);
    expect(out.lastOutbound).toBe('1. 250g\n2. 500g');
  });

  it('is empty, not an error, for an empty conversation', () => {
    expect(selectHistory([], 'x', 10)).toEqual({ turns: [], customerMessages: [], lastOutbound: null });
  });
});
