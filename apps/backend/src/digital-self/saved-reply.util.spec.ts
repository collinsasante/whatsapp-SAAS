import { compileSavedReply, matchesSavedReply, templateBodyText } from './saved-reply.util';
import { isEligibleHumanMessage, type CandidateMessage } from './message-features.util';

const SAVED = [
  'Thank you for contacting us. Our shop is open from 9am to 5pm, Monday to Saturday.',
  'Hi {{customer_name}}, your order {{order_number}} has been received and is being prepared.',
  'Hello {{customer_name}}, this is {{agent_name}} from Acme. How can I help you today?',
  '{{customer_name}}',
  'Your ticket {{ticket_id}} is open.\nWe will reply within 24 hours.',
];

describe('matchesSavedReply', () => {
  it('matches an exact saved reply, ignoring case and whitespace differences', () => {
    expect(matchesSavedReply('Thank you for contacting us. Our shop is open from 9am to 5pm, Monday to Saturday.', SAVED)).toBe(true);
    expect(matchesSavedReply('  thank you for contacting us.   Our shop is open from 9am to 5pm, Monday to Saturday. ', SAVED)).toBe(true);
  });

  it('matches a saved reply whose customer name has been filled in', () => {
    expect(matchesSavedReply('Hello Kwame Mensah, this is Ama from Acme. How can I help you today?', SAVED)).toBe(true);
    expect(matchesSavedReply('Hello Abena, this is Kofi from Acme. How can I help you today?', SAVED)).toBe(true);
  });

  it('matches a saved reply whose order number has been filled in', () => {
    expect(matchesSavedReply('Hi Abena, your order #10442 has been received and is being prepared.', SAVED)).toBe(true);
    expect(matchesSavedReply('Hi Abena, your order ORD-2026-000771 has been received and is being prepared.', SAVED)).toBe(true);
  });

  it('matches a multi-line saved reply written on one line, and one with a date or id filled in', () => {
    expect(matchesSavedReply('Your ticket 3F9A1C2B is open. We will reply within 24 hours.', SAVED)).toBe(true);
  });

  it('does NOT match a genuine reply that merely resembles a saved reply', () => {
    // Same opening, but the agent kept going in their own words.
    expect(matchesSavedReply('Hi Abena, your order #10442 has been received and is being prepared. I will personally check the colour for you.', SAVED)).toBe(false);
    expect(matchesSavedReply('Thank you for contacting us! We close at 5 today though, so come early.', SAVED)).toBe(false);
    expect(matchesSavedReply('Hello Abena, this is Ama. What colour were you after?', SAVED)).toBe(false);
    expect(matchesSavedReply('Our shop is open from 9am to 5pm', SAVED)).toBe(false); // only part of the saved reply
  });

  it('does not let a variable-only saved reply swallow ordinary messages', () => {
    expect(compileSavedReply('{{customer_name}}')).toBeNull();
    expect(matchesSavedReply('Sure, I can send the picture now', ['{{customer_name}}', '{{a}} {{b}}'])).toBe(false);
  });

  it('does not let a variable absorb a long free-text passage', () => {
    const long = 'x'.repeat(200);
    expect(matchesSavedReply(`Hi ${long}, your order #1 has been received and is being prepared.`, SAVED)).toBe(false);
  });

  it('treats regex characters in a saved reply literally', () => {
    expect(matchesSavedReply('Price (GH₵50.00)? Yes.', ['Price (GH₵50.00)? Yes.'])).toBe(true);
    expect(matchesSavedReply('Price (GH₵50x00)? Yes.', ['Price (GH₵50.00)? Yes.'])).toBe(false);
  });

  it('is false for empty input and for no saved replies', () => {
    expect(matchesSavedReply('', SAVED)).toBe(false);
    expect(matchesSavedReply('Hello there, how are you?', [])).toBe(false);
  });
});

describe('templateBodyText', () => {
  it('reads the BODY component of a WhatsApp template and ignores the rest', () => {
    const components = [{ type: 'HEADER', text: 'Header' }, { type: 'BODY', text: 'Hi {{1}}, your order {{2}} is ready.' }, { type: 'FOOTER', text: 'Acme' }];
    expect(templateBodyText(components)).toBe('Hi {{1}}, your order {{2}} is ready.');
    expect(templateBodyText([])).toBeNull();
    expect(templateBodyText('nope')).toBeNull();
  });
  it('a template body with numbered variables is matched once its variables are filled in', () => {
    const body = templateBodyText([{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} is ready for pickup.' }])!;
    expect(matchesSavedReply('Hi Kofi, your order 10442 is ready for pickup.', [body])).toBe(true);
  });
});

const base: CandidateMessage = { tenantId: 't1', direction: 'OUTBOUND', type: 'TEXT', senderId: 'ama', senderIsAiAgent: false, templateId: null, content: 'Sure, one moment please', metadata: null };
const eligible = (over: Partial<CandidateMessage>) => isEligibleHumanMessage({ ...base, ...over }, 't1', 'ama');

describe('automated and AI-written messages are never eligible', () => {
  it('a human typing is eligible (control)', () => expect(eligible({})).toBe(true));

  it('rejects the AI agent, an AI reply with no sender, and workflow messages (which carry no human sender)', () => {
    expect(eligible({ senderIsAiAgent: true })).toBe(false);
    expect(eligible({ senderId: null, senderIsAiAgent: null })).toBe(false); // welcome message, CSAT thank-you, chatbot flow, automation, campaign
  });

  it.each([
    ['an explicit saved reply', { source: 'saved_reply', cannedResponseId: 'c1' }],
    ['an AI suggestion sent from the inbox', { source: 'ai_suggestion', aiSuggestionLogId: 'l1' }],
    ['an auto-reply', { isAutoReply: true }],
    ['an AI-generated message', { aiGenerated: true }],
    ['an automation message', { automation: true }],
    ['a campaign message', { campaignId: 'camp1' }],
    ['a chatbot flow message', { flowId: 'f1' }],
    ['a commerce AI message', { commerce: true }],
    ['a simulated message', { simulated: true }],
    ['a message typed on the phone app', { source: 'external' }],
  ])('rejects %s even if a human sender is recorded', (_label, metadata) => {
    expect(eligible({ metadata })).toBe(false);
  });

  it('still accepts unrelated metadata such as a reply-to or a reaction', () => {
    expect(eligible({ metadata: { replyToPreview: 'x' } })).toBe(true);
  });
});
