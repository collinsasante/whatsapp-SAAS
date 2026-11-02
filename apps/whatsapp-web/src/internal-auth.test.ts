import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createRequireInternalKey, internalKeyMatches } from './internal-auth';

function run(expected: string | undefined, header: string | undefined) {
  let status = 0;
  let nextCalled = false;
  const req = { header: () => header } as unknown as Request;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  createRequireInternalKey(expected)(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('valid key is admitted', () => assert.deepEqual(run('s3cret', 's3cret'), { status: 0, nextCalled: true }));
test('wrong key is refused with 401', () => assert.deepEqual(run('s3cret', 'nope'), { status: 401, nextCalled: false }));
test('missing header is refused with 401', () => assert.deepEqual(run('s3cret', undefined), { status: 401, nextCalled: false }));
test('empty header is refused with 401', () => assert.deepEqual(run('s3cret', ''), { status: 401, nextCalled: false }));
test('unconfigured key refuses everything, even an empty or any header (fail closed)', () => {
  assert.deepEqual(run(undefined, undefined), { status: 503, nextCalled: false });
  assert.deepEqual(run('', ''), { status: 503, nextCalled: false });
  assert.deepEqual(run('', 'anything'), { status: 503, nextCalled: false });
});
test('internalKeyMatches never matches empty values', () => {
  assert.equal(internalKeyMatches('', ''), false);
  assert.equal(internalKeyMatches(undefined, 'x'), false);
  assert.equal(internalKeyMatches('x', 'x'), true);
});
