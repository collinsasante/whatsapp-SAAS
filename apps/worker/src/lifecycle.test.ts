import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runWithLifecycle, type LifecycleLogger } from './lib/lifecycle';

function harness(options: { shutdownTimeoutMs?: number } = {}) {
  const proc = new EventEmitter();
  const exits: number[] = [];
  const errors: string[] = [];
  const logger: LifecycleLogger = { log: () => undefined, error: (m) => { errors.push(m); } };
  const run = (start: () => Promise<() => Promise<void>>) =>
    runWithLifecycle(start, { proc: proc as never, exit: (c) => { exits.push(c); }, logger, ...options });
  return { proc, exits, errors, run };
}
const tick = () => new Promise((r) => setImmediate(r));

test('a startup failure exits 1 so the supervisor restarts the container (it used to stay alive doing nothing)', async () => {
  const h = harness();
  await h.run(async () => { throw new Error('database unreachable'); });
  assert.deepEqual(h.exits, [1]);
  assert.match(h.errors.join('\n'), /failed to start.*database unreachable/s);
});

test('SIGTERM stops everything once and exits 0', async () => {
  const h = harness();
  let stops = 0;
  await h.run(async () => async () => { stops++; });
  h.proc.emit('SIGTERM');
  h.proc.emit('SIGTERM');
  h.proc.emit('SIGINT');
  await tick();
  assert.equal(stops, 1);
  assert.deepEqual(h.exits, [0]);
});

test('SIGINT is handled the same way (local development)', async () => {
  const h = harness();
  let stopped = false;
  await h.run(async () => async () => { stopped = true; });
  h.proc.emit('SIGINT');
  await tick();
  assert.equal(stopped, true);
  assert.deepEqual(h.exits, [0]);
});

test('a stop that throws exits 1 and is logged', async () => {
  const h = harness();
  await h.run(async () => async () => { throw new Error('close failed'); });
  h.proc.emit('SIGTERM');
  await tick();
  assert.deepEqual(h.exits, [1]);
  assert.match(h.errors.join('\n'), /error during shutdown/);
});

test('a stop that never finishes is cut off by the timeout and exits 1', async () => {
  const h = harness({ shutdownTimeoutMs: 50 });
  await h.run(async () => () => new Promise<void>(() => undefined));
  h.proc.emit('SIGTERM');
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(h.exits, [1]);
  assert.match(h.errors.join('\n'), /did not finish within 50ms/);
});

test('an unhandled rejection is logged, stops gracefully and exits 1', async () => {
  const h = harness();
  let stopped = false;
  await h.run(async () => async () => { stopped = true; });
  h.proc.emit('unhandledRejection', new Error('boom'));
  await tick();
  assert.equal(stopped, true);
  assert.deepEqual(h.exits, [1]);
  assert.match(h.errors.join('\n'), /unhandled promise rejection/);
});

test('an uncaught exception is logged, stops gracefully and exits 1', async () => {
  const h = harness();
  await h.run(async () => async () => undefined);
  h.proc.emit('uncaughtException', new Error('boom'));
  await tick();
  assert.deepEqual(h.exits, [1]);
  assert.match(h.errors.join('\n'), /uncaught exception/);
});

test('a signal that arrives before startup finishes does not leave a half-started worker running', async () => {
  const h = harness();
  const p = h.run(async () => { await new Promise((r) => setTimeout(r, 30)); return async () => undefined; });
  h.proc.emit('SIGTERM');
  await p;
  await tick();
  assert.deepEqual(h.exits, [0]);
});
