import { followUpIsBacked, isUnsupportedFollowUpPromise, promisesFollowUp } from './follow-up-promise.util';

describe('promisesFollowUp: replies that promise a follow-up', () => {
  it.each([
    "That's a great question! Our team will follow up with you shortly.",
    'Our team will follow up shortly.',
    'A team member will assist you soon.',
    'The team will get back to you tomorrow.',
    'My colleagues will reach out to you today.',
    'Someone from our team will contact you.',
    'someone will get back to you',
    "We'll get back to you with the price.",
    'I will follow up once I know more.',
    "I'll be in touch.",
    'Our support team is going to call you.',
    'A team member will get back to you about the discount.',
    'One of our team will reach out shortly.',
  ])('detects: %s', (text) => expect(promisesFollowUp(text)).toBe(true));

  it.each([
    'Delivery to Accra is GHS 30 and takes 1-2 days.',
    'We open at 8am and close at 6pm, Monday to Saturday.',
    "I don't have the price for that. If you'd like to speak with a team member, just ask.",
    'Which size do you need?',
    "I'm connecting you with a team member who can help with this.",
    "Give me a moment -- I'm having a little trouble on my end. Let me get someone to pick this up.",
    'Let me get a team member to help finish this up for you.',
    'Our team works Monday to Friday.',
    'A team member can help you with that if you ask.',
    'You can follow up with us any time on this number.',
    'Please follow up if the parcel has not arrived by Friday.',
    '',
  ])('does not flag: %s', (text) => expect(promisesFollowUp(text)).toBe(false));
});

describe('followUpIsBacked: only a tool that really arranged it counts', () => {
  it('an internal task that was created', () => {
    expect(followUpIsBacked([{ name: 'create_internal_task', result: { taskId: 'task-1', status: 'OPEN' } }])).toBe(true);
  });
  it('an order that went to the approval queue', () => {
    expect(followUpIsBacked([{ name: 'submit_order_for_payment', result: { status: 'AWAITING_APPROVAL' } }])).toBe(true);
  });
  it.each([
    ['no trace', undefined],
    ['an empty trace', []],
    ['a task tool that returned an error', [{ name: 'create_internal_task', result: { error: 'department, title, and description are required' } }]],
    ['a task result with no task id', [{ name: 'create_internal_task', result: { status: 'OPEN' } }]],
    ['a malformed result', [{ name: 'create_internal_task', result: 'ok' }]],
    ['a null result', [{ name: 'create_internal_task', result: null }]],
    ['an order that went straight to payment', [{ name: 'submit_order_for_payment', result: { status: 'PENDING_PAYMENT', paymentUrl: 'x' } }]],
    ['an unrelated tool', [{ name: 'search_products', result: { taskId: 'task-1' } }]],
    ['a trace that is not an array', { name: 'create_internal_task' }],
  ])('not backed: %s', (_label, trace) => expect(followUpIsBacked(trace)).toBe(false));
});

describe('isUnsupportedFollowUpPromise', () => {
  it('a promise with nothing behind it is unsupported', () => expect(isUnsupportedFollowUpPromise('Our team will follow up shortly.', undefined)).toBe(true));
  it('the same promise after a real task was created is allowed', () => {
    expect(isUnsupportedFollowUpPromise('Our team will follow up shortly.', [{ name: 'create_internal_task', result: { taskId: 't1' } }])).toBe(false);
  });
  it('a reply with no promise is never unsupported', () => expect(isUnsupportedFollowUpPromise('Delivery is GHS 30.', undefined)).toBe(false));
});
