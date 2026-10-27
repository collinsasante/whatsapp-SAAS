import { loadHistory } from './history-loader.util';

const row = (id: string, direction: string, content: string | null, mediaCaption: string | null, ms: number) =>
  ({ id, direction, content, mediaCaption, createdAt: new Date(ms) });

/** Newest first, as the query returns it. */
const reader = (rows: ReturnType<typeof row>[]) => ({ message: { findMany: jest.fn().mockResolvedValue(rows) } });

describe('loadHistory: caption-only media rows', () => {
  it('uses the customer\'s caption as the turn text and keeps order around text and assistant rows', async () => {
    const r = reader([
      row('m4', 'INBOUND', 'how much?', null, 4),
      row('m3', 'OUTBOUND', 'Yes we have it.', null, 3),
      row('m2', 'INBOUND', null, 'do you have this one?', 2),
      row('m1', 'INBOUND', 'hello', null, 1),
    ]);
    const h = await loadHistory(r as never, { tenantId: 't1' }, 12, 'm4');
    expect(h.turns).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'do you have this one?' },
      { role: 'assistant', content: 'Yes we have it.' },
    ]);
    expect(h.customerMessages).toEqual(['hello', 'do you have this one?']);
  });

  it('prefers the body over the caption and never invents text for a row with neither', async () => {
    const r = reader([row('m3', 'INBOUND', 'now', null, 3), row('m2', 'INBOUND', null, null, 2), row('m1', 'INBOUND', 'body', 'ignored caption', 1)]);
    expect((await loadHistory(r as never, { tenantId: 't1' }, 12, 'm3')).turns).toEqual([{ role: 'user', content: 'body' }]);
  });

  it('does not query when the conversation was not verified', async () => {
    const r = reader([]);
    expect((await loadHistory(r as never, null, 12, 'x')).turns).toEqual([]);
    expect(r.message.findMany).not.toHaveBeenCalled();
  });

  it('asks the database for only the fields it needs (no media URL or type)', async () => {
    const r = reader([]);
    await loadHistory(r as never, { tenantId: 't1' }, 12);
    expect(r.message.findMany.mock.calls[0][0].select).toEqual({ id: true, direction: true, content: true, mediaCaption: true, createdAt: true });
  });
});
