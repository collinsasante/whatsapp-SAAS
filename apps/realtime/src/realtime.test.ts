import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createRequireInternalSecret } from './internal-auth';
import { conversationRoom, isValidId } from './rooms';

function run(expected: string | undefined, header: string | undefined) {
  let status = 0;
  let nextCalled = false;
  const req = { header: () => header } as unknown as Request;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  createRequireInternalSecret(expected)(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('valid secret is admitted', () => assert.deepEqual(run('s', 's'), { status: 0, nextCalled: true }));
test('wrong, missing and empty secrets are refused', () => {
  assert.deepEqual(run('s', 'x'), { status: 401, nextCalled: false });
  assert.deepEqual(run('s', undefined), { status: 401, nextCalled: false });
  assert.deepEqual(run('s', ''), { status: 401, nextCalled: false });
});
test('with no secret configured everything is refused (fail closed)', () => {
  for (const expected of [undefined, '']) {
    assert.deepEqual(run(expected, undefined), { status: 503, nextCalled: false });
    assert.deepEqual(run(expected, ''), { status: 503, nextCalled: false });
    assert.deepEqual(run(expected, 'anything'), { status: 503, nextCalled: false });
  }
});
test('the same conversation id in two workspaces maps to different rooms', () => {
  assert.notEqual(conversationRoom('tenant-a', 'conv-1'), conversationRoom('tenant-b', 'conv-1'));
});
test('conversation ids must be short non-empty strings', () => {
  assert.equal(isValidId('conv-1'), true);
  for (const bad of ['', undefined, null, 5, {}, 'x'.repeat(129)]) assert.equal(isValidId(bad), false);
});
