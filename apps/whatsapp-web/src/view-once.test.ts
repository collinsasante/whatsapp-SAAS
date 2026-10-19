import test from 'node:test';
import assert from 'node:assert/strict';
import { isViewOnceMessage } from './view-once';

test('wrapper forms are view-once', () => {
  assert.ok(isViewOnceMessage({ viewOnceMessage: {} }));
  assert.ok(isViewOnceMessage({ viewOnceMessageV2: {} }));
  assert.ok(isViewOnceMessage({ viewOnceMessageV2Extension: {} }));
});

test('the viewOnce flag on image, video and audio is view-once', () => {
  assert.ok(isViewOnceMessage({ imageMessage: { viewOnce: true } }));
  assert.ok(isViewOnceMessage({ videoMessage: { viewOnce: true } }));
  assert.ok(isViewOnceMessage({ audioMessage: { viewOnce: true } }));
});

test('either form inside a disappearing-messages chat is still view-once', () => {
  assert.ok(isViewOnceMessage({ ephemeralMessage: { message: { viewOnceMessageV2: {} } } }));
  assert.ok(isViewOnceMessage({ ephemeralMessage: { message: { imageMessage: { viewOnce: true } } } }));
});

test('ordinary media and text are not view-once', () => {
  assert.ok(!isViewOnceMessage({ imageMessage: { viewOnce: false } }));
  assert.ok(!isViewOnceMessage({ imageMessage: {} }));
  assert.ok(!isViewOnceMessage({ videoMessage: { viewOnce: null } }));
  assert.ok(!isViewOnceMessage({ audioMessage: {} }));
  assert.ok(!isViewOnceMessage({ ephemeralMessage: { message: { imageMessage: {} } } }));
  assert.ok(!isViewOnceMessage({ conversation: 'hi' } as never));
  assert.ok(!isViewOnceMessage(null));
  assert.ok(!isViewOnceMessage(undefined));
});
