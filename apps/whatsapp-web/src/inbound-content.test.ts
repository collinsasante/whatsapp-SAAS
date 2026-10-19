import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInboundContent, labelForUnknownKind } from './inbound-content';

test('plain conversation text is delivered as text', () => {
  assert.deepEqual(extractInboundContent({ conversation: 'Hi' }), { action: 'deliver', text: 'Hi' });
});

test('extended text (links, replies, long text) is delivered as text', () => {
  assert.deepEqual(extractInboundContent({ extendedTextMessage: { text: 'see https://x.test' } }), { action: 'deliver', text: 'see https://x.test' });
});

test('interactive replies keep their visible text', () => {
  assert.equal((extractInboundContent({ buttonsResponseMessage: { selectedButtonId: 'b1', selectedDisplayText: 'Yes' } }) as { text: string }).text, 'Yes');
  assert.equal((extractInboundContent({ templateButtonReplyMessage: { selectedId: 'a', selectedDisplayText: 'Track order' } }) as { text: string }).text, 'Track order');
  assert.equal((extractInboundContent({ listResponseMessage: { title: 'Option 2', singleSelectReply: {} } }) as { text: string }).text, 'Option 2');
});

test('text is found even next to messageContextInfo, which accompanies most real messages', () => {
  assert.deepEqual(extractInboundContent({ conversation: 'Hello', messageContextInfo: { deviceListMetadata: {} } }), { action: 'deliver', text: 'Hello' });
});

test('images, video, audio and documents are media with caption and mimetype', () => {
  assert.deepEqual(extractInboundContent({ imageMessage: { caption: 'receipt', mimetype: 'image/jpeg' } }), { action: 'deliver', media: { kind: 'image', caption: 'receipt', mimetype: 'image/jpeg' } });
  assert.equal((extractInboundContent({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }) as { media: { kind: string } }).media.kind, 'audio');
  assert.equal((extractInboundContent({ documentMessage: { mimetype: 'application/pdf' } }) as { media: { kind: string } }).media.kind, 'document');
  assert.equal((extractInboundContent({ videoMessage: {} }) as { media: { kind: string } }).media.kind, 'video');
});

test('reactions, edits/deletes, key exchange and bare context info are not customer messages', () => {
  for (const m of [
    { reactionMessage: { text: '👍', key: {} } },
    { protocolMessage: { type: 0, key: {} } },
    { senderKeyDistributionMessage: { groupId: 'g' } },
    { messageContextInfo: {} },
    { senderKeyDistributionMessage: {}, messageContextInfo: {} },
    {},
    null,
  ]) assert.equal(extractInboundContent(m as never).action, 'ignore');
});

test('known non-text types get a specific label, not the generic unsupported text', () => {
  const label = (m: object) => (extractInboundContent(m as never) as { fallback?: string }).fallback;
  assert.equal(label({ stickerMessage: {} }), '[Sticker]');
  assert.equal(label({ locationMessage: { name: 'Accra Mall' } }), '[Location: Accra Mall]');
  assert.equal(label({ locationMessage: { degreesLatitude: 5.6 } }), '[Location shared]');
  assert.equal(label({ contactMessage: { displayName: 'Kofi' } }), '[Contact card: Kofi]');
  assert.equal(label({ pollCreationMessageV3: { name: 'Lunch?' } }), '[Poll: Lunch?]');
  assert.equal(label({ groupInviteMessage: {} }), '[Group invite]');
});

test('business-style messages deliver their readable text, not a placeholder', () => {
  const text = (m: object) => (extractInboundContent(m as never) as { text?: string }).text;
  assert.equal(text({ interactiveMessage: { body: { text: 'Choose a delivery slot' } } }), 'Choose a delivery slot');
  assert.equal(text({ buttonsMessage: { contentText: 'Do you want to continue?' } }), 'Do you want to continue?');
  assert.equal(text({ listMessage: { title: 'Menu', description: 'Pick one' } }), 'Pick one');
  assert.equal(text({ templateMessage: { hydratedTemplate: { hydratedContentText: 'Your order shipped' } } }), 'Your order shipped');
  assert.equal(text({ commentMessage: { message: { conversation: 'Great post' } } }), 'Great post');
});

test('an event invitation is labelled with its name', () => {
  assert.equal((extractInboundContent({ eventMessage: { name: 'Launch party' } }) as { fallback?: string }).fallback, '[Event invitation: Launch party]');
  assert.equal((extractInboundContent({ eventMessage: {} }) as { fallback?: string }).fallback, '[Event invitation]');
});

test('an unlisted kind gets a label naming it, never the generic "type we can\'t display"', () => {
  const fb = (m: object) => (extractInboundContent(m as never) as { fallback?: string }).fallback;
  assert.equal(fb({ paymentInviteMessage: { serviceType: 1 } }), '[Sent a payment invite message]');
  assert.equal(fb({ interactiveMessage: { nativeFlowMessage: {} } }), '[Sent an interactive message]');
  assert.equal(fb({ someFutureKind: {} }), '[Sent a some future kind message]');
  assert.equal(fb({ requestPhoneNumberMessage: {} }), '[Sent a request phone number message]');
});

test('labelForUnknownKind is built from the key only and rejects odd input', () => {
  assert.equal(labelForUnknownKind(undefined), undefined);
  assert.equal(labelForUnknownKind('not a key!'), undefined);
  assert.equal(labelForUnknownKind('Message'), undefined);
});

test('empty strings do not count as text', () => {
  assert.equal(extractInboundContent({ conversation: '   ' }).action, 'deliver');
  assert.equal((extractInboundContent({ conversation: '   ' }) as { text?: string }).text, undefined);
});
