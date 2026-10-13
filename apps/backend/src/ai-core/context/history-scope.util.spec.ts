import { buildHistoryWhere, buildConversationHistoryWhere } from './history-scope.util';

describe('buildHistoryWhere', () => {
  it('scopes to tenant AND contact (via the conversation relation) when contactId is valid', () => {
    expect(buildHistoryWhere('t1', { id: 'c1', contactId: 'contact-1' })).toEqual({
      tenantId: 't1', type: 'TEXT', content: { not: null },
      conversation: { tenantId: 't1', contactId: 'contact-1' },
    });
  });

  it.each([[undefined], [null], [''], ['   ']])('falls back to the verified conversation id when contactId is %p -- never an absent filter', (contactId) => {
    const where = buildHistoryWhere('t1', { id: 'c1', contactId: contactId as never });
    expect(where).toEqual({ tenantId: 't1', type: 'TEXT', content: { not: null }, conversationId: 'c1' });
    expect(where).not.toHaveProperty('conversation');
  });

  it('returns null (caller must use empty history) when the conversation was not verified', () => {
    expect(buildHistoryWhere('t1', null)).toBeNull();
    expect(buildHistoryWhere('t1', undefined)).toBeNull();
    expect(buildHistoryWhere('t1', { id: '', contactId: 'x' })).toBeNull();
  });

  it('returns null when tenantId is missing', () => {
    expect(buildHistoryWhere('', { id: 'c1', contactId: 'x' })).toBeNull();
  });

  it('never produces a where with an undefined value anywhere (Prisma would drop it and broaden the query)', () => {
    const walk = (o: unknown): boolean => o === undefined || (typeof o === 'object' && o !== null && Object.values(o).some(walk));
    for (const contactId of [undefined, null, '', 'abc']) {
      expect(walk(buildHistoryWhere('t1', { id: 'c1', contactId }))).toBe(false);
    }
  });
});

describe('buildConversationHistoryWhere', () => {
  it('scopes to tenant AND the single conversation, with no contact widening', () => {
    expect(buildConversationHistoryWhere('t1', 'c1')).toEqual({ tenantId: 't1', conversationId: 'c1', type: 'TEXT', content: { not: null } });
  });

  it.each([[undefined], [null], ['']])('returns null for a blank conversation id (%p) so no query is issued', (id) => {
    expect(buildConversationHistoryWhere('t1', id as never)).toBeNull();
  });

  it('returns null for a blank tenant id', () => {
    expect(buildConversationHistoryWhere('', 'c1')).toBeNull();
  });

  it('never contains an undefined value anywhere in the produced where', () => {
    const walk = (o: unknown): boolean => o === undefined || (typeof o === 'object' && o !== null && Object.values(o).some(walk));
    expect(walk(buildConversationHistoryWhere('t1', 'c1'))).toBe(false);
  });
});
