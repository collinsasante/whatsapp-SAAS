import { VerificationService } from './verification.service';
import { RetrievedChunk } from './retrieval.service';

function chunk(id: string, content: string): RetrievedChunk {
  return { id, articleId: `article-${id}`, heading: null, content, score: 1, matchedBy: ['vector'] };
}

describe('VerificationService', () => {
  const svc = new VerificationService();

  it('passes a well-grounded ANSWER with a matching cited price', () => {
    const chunks = [chunk('c1', 'Our Starter plan is GHS 200 per month.')];
    const result = svc.verify({
      response: 'The Starter plan is GHS 200/month.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'How much is the Starter plan?',
    });
    expect(result.passed).toBe(true);
  });

  it('is the "never say GHS 45 when the source says GHS 50" guarantee', () => {
    const chunks = [chunk('c1', 'The Pro plan costs GHS 50 per month.')];
    const result = svc.verify({
      response: 'The Pro plan is GHS 45 per month.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'How much is Pro?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/price/i);
  });

  it('does not penalize correctly refuting a false premise (real eval failure this caught)', () => {
    // Found by the eval harness: "The Pro plan is GHS 313, not GHS 250" is the
    // model correctly rejecting a customer's wrong assumption -- both numbers
    // are mentioned, but only 313 is asserted as fact. Extracting "GHS 250" as
    // an unverified price and blocking this was a real production bug.
    const chunks = [chunk('c1', 'The Pro plan costs GHS 313 per month.')];
    const result = svc.verify({
      response: 'The Pro plan is GHS 313 per month, not GHS 250.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'Is Pro GHS 250?',
    });
    expect(result.passed).toBe(true);
  });

  it('still blocks when the WRONG price is asserted first and the right one only implied', () => {
    const chunks = [chunk('c1', 'The Pro plan costs GHS 313 per month.')];
    const result = svc.verify({
      response: 'Yes, the Pro plan is GHS 250 per month.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'Is Pro GHS 250?',
    });
    expect(result.passed).toBe(false);
  });

  it('blocks an ANSWER with empty sources', () => {
    const result = svc.verify({
      response: 'It costs GHS 50.',
      action: 'ANSWER',
      sources: [],
      retrievedChunks: [chunk('c1', 'Pro plan is GHS 50.')],
      customerMessage: 'price?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/no cited sources/i);
  });

  it('blocks a cited source id that was never actually retrieved', () => {
    const result = svc.verify({
      response: 'It costs GHS 50.',
      action: 'ANSWER',
      sources: ['made-up-id'],
      retrievedChunks: [chunk('c1', 'Pro plan is GHS 50.')],
      customerMessage: 'price?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/not actually retrieved/i);
  });

  it('blocks a phone number not present in the cited chunks', () => {
    const chunks = [chunk('c1', 'Our support line is 0244000000.')];
    const result = svc.verify({
      response: 'Call us on 0244111111.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'phone number?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/phone/i);
  });

  it('blocks a URL not present in the cited chunks', () => {
    const chunks = [chunk('c1', 'Visit https://verzchat.com/pricing for details.')];
    const result = svc.verify({
      response: 'See https://verzchat.com/fake-page for details.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'link?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/url/i);
  });

  it('blocks an unsupported qualifier the source never used (real eval failure this caught)', () => {
    // Found by the eval harness: the model consistently added "official
    // APIs" for a channels question when the source only listed channel
    // names, never the word "official". A free-text claim like this isn't a
    // price/phone/URL, but it's still an invented fact.
    const chunks = [chunk('c1', 'VerzChat connects WhatsApp, Instagram, and Telegram into one inbox.')];
    const result = svc.verify({
      response: 'We support WhatsApp, Instagram, and Telegram, all via official APIs.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'what channels, and are they official?',
    });
    expect(result.passed).toBe(false);
    expect(result.failReason).toMatch(/qualifier/i);
  });

  it('allows a qualifier the source explicitly does use', () => {
    const chunks = [chunk('c1', 'We use the official WhatsApp Business API.')];
    const result = svc.verify({
      response: 'We use the official WhatsApp Business API.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'is it official?',
    });
    expect(result.passed).toBe(true);
  });

  it('always passes ESCALATE/CLARIFY without checking grounding', () => {
    const result = svc.verify({
      response: "Let me get a teammate to help with that.",
      action: 'ESCALATE',
      sources: [],
      retrievedChunks: [],
      customerMessage: 'something obscure',
    });
    expect(result.passed).toBe(true);
  });

  it('accepts a price stated in a different format than the source (₵ vs GHS)', () => {
    const chunks = [chunk('c1', 'The Starter plan is GHS 200/month.')];
    const result = svc.verify({
      response: 'That plan is ₵200 per month.',
      action: 'ANSWER',
      sources: ['c1'],
      retrievedChunks: chunks,
      customerMessage: 'price in cedis?',
    });
    expect(result.passed).toBe(true);
  });
});
