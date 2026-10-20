import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUndecryptable } from './undecryptable';

test('"absent from node" becomes a placeholder with an id distinct from the real message id', () => {
  assert.deepEqual(
    classifyUndecryptable({ key: { id: 'ABC' }, messageStubType: 2, messageStubParameters: ['Message absent from node'] }),
    { action: 'placeholder', providerMessageId: 'ABC:unavailable' },
  );
});

test('a decryption failure is not surfaced (WhatsApp re-sends it with the same id)', () => {
  assert.deepEqual(
    classifyUndecryptable({ key: { id: 'ABC' }, messageStubType: 2, messageStubParameters: ['Bad MAC'] }),
    { action: 'ignore', reason: 'decrypt-error' },
  );
});

test('other stub types and missing ids are ignored', () => {
  assert.equal(classifyUndecryptable({ key: { id: 'ABC' }, messageStubType: 20 }).action, 'ignore');
  assert.equal(classifyUndecryptable({ key: { id: 'ABC' } }).action, 'ignore');
  assert.equal(classifyUndecryptable({ key: {}, messageStubType: 2, messageStubParameters: ['Message absent from node'] }).action, 'ignore');
});
