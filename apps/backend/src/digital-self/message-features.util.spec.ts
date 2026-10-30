import { extractFeatures, isEligibleHumanMessage, type CandidateMessage } from './message-features.util';

const base: CandidateMessage = { tenantId: 't1', direction: 'OUTBOUND', type: 'TEXT', senderId: 'ama', senderIsAiAgent: false, templateId: null, content: 'Hello, how can I help?', metadata: null };
const ok = (over: Partial<CandidateMessage> = {}) => isEligibleHumanMessage({ ...base, ...over }, 't1', 'ama');

describe('isEligibleHumanMessage', () => {
  it('accepts a human agent text reply', () => expect(ok()).toBe(true));
  it('rejects the AI agent user and an AI reply with no sender', () => {
    expect(ok({ senderIsAiAgent: true })).toBe(false);
    expect(ok({ senderId: null, senderIsAiAgent: null })).toBe(false);
  });
  it('rejects another agent\'s message, so profiles never mix', () => expect(ok({ senderId: 'kofi' })).toBe(false));
  it('rejects a message from another tenant', () => expect(ok({ tenantId: 't2' })).toBe(false));
  it('rejects inbound (customer) messages', () => expect(ok({ direction: 'INBOUND' })).toBe(false));
  it('rejects non-text, templates and empty content', () => {
    expect(ok({ type: 'IMAGE' })).toBe(false);
    expect(ok({ templateId: 'tpl' })).toBe(false);
    expect(ok({ content: '   ' })).toBe(false);
    expect(ok({ content: null })).toBe(false);
  });
  it('rejects auto-replies, simulated runs, commerce AI output and messages typed on the phone', () => {
    for (const metadata of [{ isAutoReply: true }, { simulated: true }, { commerce: true }, { source: 'external' }]) expect(ok({ metadata })).toBe(false);
  });
  it('rejects pasted walls of text', () => expect(ok({ content: 'a '.repeat(1500) })).toBe(false));
});

describe('extractFeatures', () => {
  it('returns null for text with no words', () => {
    expect(extractFeatures('   ')).toBeNull();
    expect(extractFeatures('!!! ???')).toBeNull();
  });
  it('detects question, exclamation, emoji, contraction and greeting', () => {
    const f = extractFeatures("Hello! I'm happy to help 😊 Which size do you want?")!;
    expect(f).toMatchObject({ hasQuestion: true, hasExclaim: true, hasEmoji: true, hasContraction: true, greeting: 'hello' });
  });
  it('detects a thank-you close and a formal register', () => {
    const f = extractFeatures('Kindly confirm your address. Thank you.')!;
    expect(f.closing).toBe('thanks');
    expect(f.formalMarkers).toBeGreaterThan(0);
  });
  it('tags lexical language markers and does not tag plain English as Pidgin', () => {
    expect(extractFeatures('Abeg wait small, wetin you want?')!.languages).toContain('pidgin');
    expect(extractFeatures('Medaase, your order is ready')!.languages).toContain('twi');
    expect(extractFeatures('Your order is ready for pickup')!.languages).toEqual(['english']);
  });
  it('does not keep the message text', () => {
    expect(JSON.stringify(extractFeatures('My secret phrase 0244000000'))).not.toMatch(/0244|secret/);
  });
});
