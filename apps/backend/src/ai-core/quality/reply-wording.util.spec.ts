import { reviewReplyWording, WordingContext, WordingIssue } from './reply-wording.util';

/**
 * Controlled fixtures. The "before" replies are what the retired prompts instructed the model to send; the "after" replies are
 * hand-written examples of the intended behaviour. NEITHER is live model output: this spec proves the checker catches the problems
 * and passes the intended shape. It is not evidence that a model now writes more naturally (that needs a live evaluation).
 */
describe('reviewReplyWording: before (retired wording) is flagged', () => {
  const cases: Array<[string, string, WordingContext, WordingIssue[]]> = [
    ['the canned fallback', "That's a great question! Our team will follow up with you shortly.", {}, ['filler_opening', 'unsupported_follow_up_promise']],
    ['filler before a factual answer', 'Great question! Delivery to Accra is GHS 30.', {}, ['filler_opening']],
    ['thanks-for-reaching-out opener', 'Thanks for reaching out! We open at 8am.', {}, ['filler_opening']],
    ['the name in two replies in a row', 'Sure, Kwame, the 500g jar is GHS 45.', { customerName: 'Kwame', previousAssistantReplies: ['Hi Kwame, welcome!'] }, ['name_in_consecutive_replies']],
    ['a second greeting', 'Hello! The jar is GHS 45.', { previousAssistantReplies: ['Hi there, welcome to Acme.'] }, ['repeated_greeting']],
    ['a second apology', 'Sorry about that, the jar is GHS 45.', { previousAssistantReplies: ["I'm sorry, I missed that."] }, ['repeated_apology']],
    ['a follow-up promise with no task', 'A team member will get back to you about the discount.', {}, ['unsupported_follow_up_promise']],
    ['a promise after a failed task', 'Our team will follow up.', { toolTrace: [{ name: 'create_internal_task', result: { error: 'x' } }] }, ['unsupported_follow_up_promise']],
  ];
  it.each(cases)('%s', (_label, reply, ctx, expected) => expect(reviewReplyWording(reply, ctx).sort()).toEqual([...expected].sort()));
});

describe('reviewReplyWording: after (intended behaviour) is clean', () => {
  const cases: Array<[string, string, WordingContext]> = [
    ['a direct factual answer', 'Delivery to Accra is GHS 30 and takes one to two days.', {}],
    ['the name used once, naturally, when greeting', 'Hi Kwame, welcome to Acme. What can I help you with?', { customerName: 'Kwame' }],
    ['no name on the next reply', 'The 500g jar is GHS 45.', { customerName: 'Kwame', previousAssistantReplies: ['Hi Kwame, welcome to Acme.'] }],
    ['a clarifying question for a missing detail', 'Which size do you need, 250g or 500g?', {}],
    ['an honest gap that names a real route', "I don't have the price for custom labels. If you'd like to speak to a team member, just ask.", {}],
    ['a partial answer that says what is missing', 'We deliver to Accra for GHS 30. I do not have the rate for Kumasi.', {}],
    ['a promise that a task really arranged', "I've passed this to our team and they will follow up with you.", { toolTrace: [{ name: 'create_internal_task', result: { taskId: 't1' } }] }],
    ['an answer in the customer\'s language (Pidgin) with no filler', 'Delivery to Accra na GHS 30, e go reach you in one or two days.', {}],
    ['a single apology', "Sorry, I missed that. The jar is GHS 45.", { previousAssistantReplies: ['Here is the delivery price: GHS 30.'] }],
    ['a greeting only on the first reply', 'The jar is GHS 45.', { previousAssistantReplies: ['Hi there, welcome to Acme.'] }],
  ];
  it.each(cases)('%s', (_label, reply, ctx) => expect(reviewReplyWording(reply, ctx)).toEqual([]));
});

describe('reviewReplyWording: edge cases', () => {
  it('a name that merely contains another word is not matched (word boundaries)', () => {
    expect(reviewReplyWording('Ann, here you go.', { customerName: 'An', previousAssistantReplies: ['Hi An'] })).toEqual([]);
  });
  it('a name with regex characters does not throw', () => {
    expect(() => reviewReplyWording('Hi (Kwame+)', { customerName: '(Kwame+)', previousAssistantReplies: ['Hi (Kwame+)'] })).not.toThrow();
  });
  it('an empty reply has no issues', () => expect(reviewReplyWording('')).toEqual([]));
});
