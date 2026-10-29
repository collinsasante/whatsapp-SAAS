import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { buildRecord, HELDOUT_PERCENT, MAX_TURNS, pseudonym, RawConversation, RawMessage, roleOf, splitFor, strataOf } from './dataset-builder.util';

const KEY = 'k'.repeat(40);
const T = (s: number) => new Date(Date.UTC(2026, 9, 5, 10, 0, s));
let n = 0;
const msg = (over: Partial<RawMessage> & Pick<RawMessage, 'direction'>): RawMessage => ({
  id: `m${++n}`, type: 'TEXT', content: 'hello', createdAt: T(n), metadata: null, deletedForEveryone: false, sender: null, ...over,
});
const human = { isAiAgent: false, name: 'Esi Owusu' };
const aiAgent = { isAiAgent: true, name: 'Verz' };
const conv = (messages: RawMessage[], over: Partial<RawConversation> = {}): RawConversation => ({
  id: 'conv-1', tenantId: 'tenant-1', updatedAt: T(100), createdAt: T(0),
  contact: { name: 'Kofi Mensah', phone: '+233241234567', isEvalContact: false }, messages, evaluations: [], ...over,
});

describe('roleOf', () => {
  it('maps direction, sender and metadata to a role', () => {
    expect(roleOf(msg({ direction: 'INBOUND' }))).toBe('customer');
    expect(roleOf(msg({ direction: 'OUTBOUND', sender: aiAgent }))).toBe('ai');
    expect(roleOf(msg({ direction: 'OUTBOUND', metadata: { aiGenerated: true } }))).toBe('ai');
    expect(roleOf(msg({ direction: 'OUTBOUND', sender: human }))).toBe('human_agent');
    expect(roleOf(msg({ direction: 'OUTBOUND' }))).toBe('system');
  });
});

describe('pseudonym and split', () => {
  it('is stable for the same key and input, differs by key and input, and reveals nothing readable', () => {
    const a = pseudonym(KEY, 'conv', 'tenant-1:conv-1', 24);
    expect(a).toBe(pseudonym(KEY, 'conv', 'tenant-1:conv-1', 24));
    expect(a).not.toBe(pseudonym('z'.repeat(40), 'conv', 'tenant-1:conv-1', 24));
    expect(a).not.toBe(pseudonym(KEY, 'conv', 'tenant-1:conv-2', 24));
    expect(a).toMatch(/^conv_[0-9a-f]{24}$/);
    expect(a).not.toContain('tenant');
  });
  it('the held-out share is about HELDOUT_PERCENT and a conversation never changes side', () => {
    let held = 0;
    for (let i = 0; i < 4000; i++) if (splitFor(pseudonym(KEY, 'conv', `t:${i}`, 24)) === 'heldout') held++;
    expect(held / 4000).toBeGreaterThan((HELDOUT_PERCENT - 4) / 100);
    expect(held / 4000).toBeLessThan((HELDOUT_PERCENT + 4) / 100);
    const ref = pseudonym(KEY, 'conv', 't:42', 24);
    expect(splitFor(ref)).toBe(splitFor(ref));
  });
});

describe('strataOf', () => {
  it.each([[0, 0, Infinity, Infinity, 'customer_only'], [2, 0, 1, Infinity, 'ai_only'], [0, 2, Infinity, 1, 'human_only'], [1, 1, 1, 2, 'ai_then_human'], [1, 1, 2, 1, 'human_then_ai']])('%s ai, %s human', (a, h, fa, fh, s) => expect(strataOf(a, h, fa, fh)).toBe(s));
});

describe('buildRecord', () => {
  const takeover = () => conv([
    msg({ direction: 'INBOUND', content: 'Hi Kofi here, delivery to Kumasi? my number 0241234567' }),
    msg({ direction: 'OUTBOUND', sender: aiAgent, content: 'Hello Kofi, delivery is GHS 40.' }),
    msg({ direction: 'INBOUND', content: 'No, last time it was GHS 45' }),
    msg({ direction: 'OUTBOUND', sender: human, content: 'Esi here: you are right, GHS 45. Mail esi@shop.com.' }),
  ]);

  it('builds a redacted, pseudonymized record with no identifiers, names or absolute times', () => {
    const r = buildRecord(takeover(), KEY, 'exp_1');
    if (!r.ok) throw new Error('expected a record');
    const json = JSON.stringify(r.record);
    expect(json).not.toMatch(/tenant-1|conv-1|0241234567|esi@shop|Kofi|Mensah|Esi|Owusu|233241234567/);
    expect(json).not.toMatch(/2026-10-05T/);
    expect(r.record.startedMonth).toBe('2026-10');
    expect(r.record.turns.map((t) => t.role)).toEqual(['customer', 'ai', 'customer', 'human_agent']);
    expect(r.record.turns[0].text).toContain('[PHONE]');
    expect(r.record.turns[3].text).toContain('[EMAIL]');
    expect(r.record.conversationRef).toMatch(/^conv_[0-9a-f]{24}$/);
    expect(r.record.tenantRef).toMatch(/^ten_[0-9a-f]{12}$/);
    expect(r.redactions.PHONE).toBeGreaterThan(0);
    expect(r.record.provenance).toEqual({ source: 'production', exportId: 'exp_1', redactionVersion: '1', truncatedTurns: false });
  });

  it('only human turns are listed as answer candidates; AI turns never are', () => {
    const r = buildRecord(takeover(), KEY, 'e');
    if (!r.ok) throw new Error('expected a record');
    expect(r.record.humanAnswerTurns).toEqual([3]);
    expect(r.record.turns.filter((t) => t.role === 'ai').every((t) => !r.record.humanAnswerTurns.includes(t.i))).toBe(true);
    expect(r.record.stratum).toBe('ai_then_human');
    expect(r.record.signals).toMatchObject({ aiTurns: 1, humanTurns: 1, humanTakeover: true });
  });

  it('carries the outcome signals from evaluations, without any content', () => {
    const raw = takeover();
    raw.evaluations = [
      { status: 'EVALUATED', overallScore: 3.5, failureCategories: ['HALLUCINATION'], needsHumanReview: false, customerCorrectionDetected: true, humanTakeoverFollowed: true },
      { status: 'NEEDS_REVIEW', overallScore: 2, failureCategories: ['WRONG_PRICE', 'HALLUCINATION'], needsHumanReview: true, customerCorrectionDetected: false, humanTakeoverFollowed: false },
      { status: 'PENDING', overallScore: null, failureCategories: ['IGNORED'], needsHumanReview: false, customerCorrectionDetected: false, humanTakeoverFollowed: false },
    ];
    const r = buildRecord(raw, KEY, 'e');
    if (!r.ok) throw new Error('expected a record');
    expect(r.record.signals).toMatchObject({ evaluated: true, lowestScore: 2, needsHumanReview: true, customerCorrection: true, failureCategories: ['HALLUCINATION', 'WRONG_PRICE'] });
  });

  it('has no evaluation signals when nothing was evaluated (unknown, not good)', () => {
    const r = buildRecord(takeover(), KEY, 'e');
    if (!r.ok) throw new Error('expected a record');
    expect(r.record.signals).toMatchObject({ evaluated: false, lowestScore: null, needsHumanReview: false });
  });

  it('keeps conversations where the AI was wrong and where it was right alike: no outcome-based filtering', () => {
    const ok = conv([msg({ direction: 'INBOUND', content: 'Opening hours?' }), msg({ direction: 'OUTBOUND', sender: aiAgent, content: 'We open 8am to 6pm.' })]);
    expect(buildRecord(ok, KEY, 'e').ok).toBe(true);
    expect(buildRecord(takeover(), KEY, 'e').ok).toBe(true);
  });

  describe('exclusions', () => {
    it('Test Chat conversations (reserved number, or simulated metadata) are never exported as real data', () => {
      const sim = conv([msg({ direction: 'INBOUND' }), msg({ direction: 'OUTBOUND', sender: aiAgent })], { contact: { name: 'Test', phone: simulatedPhoneFor('u1'), isEvalContact: false } });
      expect(buildRecord(sim, KEY, 'e')).toEqual({ ok: false, reason: 'simulated' });
      const flagged = conv([msg({ direction: 'INBOUND' }), msg({ direction: 'OUTBOUND', metadata: { simulated: true } })]);
      expect(buildRecord(flagged, KEY, 'e')).toEqual({ ok: false, reason: 'simulated' });
    });
    it('evaluation contacts, conversations with no customer message, and one-turn conversations', () => {
      expect(buildRecord(conv([msg({ direction: 'INBOUND' }), msg({ direction: 'OUTBOUND' })], { contact: { name: 'x', phone: '+1', isEvalContact: true } }), KEY, 'e')).toEqual({ ok: false, reason: 'eval_contact' });
      expect(buildRecord(conv([msg({ direction: 'OUTBOUND', sender: human }), msg({ direction: 'OUTBOUND', sender: human })]), KEY, 'e')).toEqual({ ok: false, reason: 'no_customer_message' });
      expect(buildRecord(conv([msg({ direction: 'INBOUND' })]), KEY, 'e')).toEqual({ ok: false, reason: 'too_short' });
    });
    it('media-only, deleted and blank messages do not count as turns', () => {
      const r = buildRecord(conv([
        msg({ direction: 'INBOUND', content: 'hi' }), msg({ direction: 'INBOUND', type: 'IMAGE', content: 'caption' }),
        msg({ direction: 'INBOUND', content: '   ' }), msg({ direction: 'INBOUND', deletedForEveryone: true, content: 'secret' }),
        msg({ direction: 'OUTBOUND', sender: human, content: 'hello' }),
      ]), KEY, 'e');
      if (!r.ok) throw new Error('expected a record');
      expect(r.record.turns.map((t) => t.text)).toEqual(['hi', 'hello']);
    });
  });

  it('drops a message stored twice in the same second, but keeps a genuine repeat later', () => {
    const a = msg({ direction: 'INBOUND', content: 'same', createdAt: T(10) });
    const b = msg({ direction: 'INBOUND', content: 'same', createdAt: new Date(T(10).getTime() + 100) });
    const c = msg({ direction: 'INBOUND', content: 'same', createdAt: T(50) });
    const r = buildRecord(conv([a, b, c, msg({ direction: 'OUTBOUND', sender: human, content: 'ok', createdAt: T(60) })]), KEY, 'e');
    if (!r.ok) throw new Error('expected a record');
    expect(r.record.turns.map((t) => t.text)).toEqual(['same', 'same', 'ok']);
  });

  it('orders turns by time, uses offsets from the first, and bounds very long conversations', () => {
    const many: RawMessage[] = [];
    for (let i = 0; i < MAX_TURNS + 10; i++) many.push(msg({ direction: i % 2 ? 'OUTBOUND' : 'INBOUND', sender: i % 2 ? human : null, content: `turn ${i}`, createdAt: T(1000 + i * 5) }));
    const r = buildRecord(conv(many.reverse()), KEY, 'e');
    if (!r.ok) throw new Error('expected a record');
    expect(r.record.turns).toHaveLength(MAX_TURNS);
    expect(r.record.turns[0]).toMatchObject({ i: 0, t: 0, text: 'turn 0' });
    expect(r.record.turns[1].t).toBe(5);
    expect(r.record.provenance.truncatedTurns).toBe(true);
  });

  it('does not mutate its input', () => {
    const raw = takeover();
    const snapshot = JSON.stringify(raw);
    buildRecord(raw, KEY, 'e');
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});
