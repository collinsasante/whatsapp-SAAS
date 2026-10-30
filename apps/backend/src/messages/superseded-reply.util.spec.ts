import { LOOKUP_ONLY_TOOLS, shouldSkipBeforeGeneration, shouldSkipBeforeSending, usedOnlyLookups } from './superseded-reply.util';

describe('shouldSkipBeforeGeneration', () => {
  it('stands aside for a newer queued turn when nothing has been spent', () => {
    expect(shouldSkipBeforeGeneration({ customerMessage: 'i want a shirt', newerTurnQueued: true })).toBe(true);
  });
  it('never skips when no newer turn is queued', () => {
    expect(shouldSkipBeforeGeneration({ customerMessage: 'i want a shirt', newerTurnQueued: false })).toBe(false);
  });
  it.each(['I need to talk to someone', 'can someone call me', 'abeg make I talk to somebody', 'let me speak to a human'])(
    'never skips a request for a person, however many messages follow: "%s"',
    (customerMessage) => expect(shouldSkipBeforeGeneration({ customerMessage, newerTurnQueued: true })).toBe(false),
  );
});

describe('usedOnlyLookups', () => {
  it('is true for no tools and for lookups and private notes only', () => {
    expect(usedOnlyLookups(undefined)).toBe(true);
    expect(usedOnlyLookups([])).toBe(true);
    expect(usedOnlyLookups([{ name: 'search_products' }, { name: 'remember_conversation_facts' }])).toBe(true);
  });
  it.each(['add_item_to_order', 'submit_order_for_payment', 'arrange_delivery', 'create_internal_task', 'send_product_image', 'set_pending_action', 'clear_pending_action'])(
    'is false once %s ran: it changed or sent something, or recorded a question the customer must see',
    (name) => expect(usedOnlyLookups([{ name: 'search_products' }, { name }])).toBe(false),
  );
  it('treats an unknown tool as not safe', () => {
    expect(usedOnlyLookups([{ name: 'some_new_tool' }])).toBe(false);
  });
  it('keeps the allow-list to lookups and private notes', () => {
    expect([...LOOKUP_ONLY_TOOLS].sort()).toEqual(['check_delivery_info', 'get_current_order', 'get_order_status', 'get_product_details', 'qualify_lead', 'remember_conversation_facts', 'search_products']);
  });
});

describe('shouldSkipBeforeSending', () => {
  const base = { newerTurnQueued: true, shouldEscalate: false, toolTrace: [{ name: 'search_products' }], hasMediaToSend: false };
  it('drops a lookup-only reply when a newer turn is queued', () => expect(shouldSkipBeforeSending(base)).toBe(true));
  it('sends when nothing newer is queued', () => expect(shouldSkipBeforeSending({ ...base, newerTurnQueued: false })).toBe(false));
  it('sends a turn that decided to hand over to a person', () => expect(shouldSkipBeforeSending({ ...base, shouldEscalate: true })).toBe(false));
  it('sends a turn that has a picture to deliver', () => expect(shouldSkipBeforeSending({ ...base, hasMediaToSend: true })).toBe(false));
  it('sends a turn that changed something', () => expect(shouldSkipBeforeSending({ ...base, toolTrace: [{ name: 'add_item_to_order' }] })).toBe(false));
});
