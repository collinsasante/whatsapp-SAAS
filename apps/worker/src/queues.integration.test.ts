import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Queue } from 'bullmq';
import axios from 'axios';
import { QueueName, type SnoozeWakeJob } from '@whatsapp-platform/shared-types';
import { SnoozeWorker } from './processors/snooze.processor';

// Real BullMQ against a real Redis that this file starts itself on a free port (nothing shared, nothing to clean up).
// Skipped, with the reason, only when no redis-server binary exists on the machine.
const HAS_REDIS = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
const skip = !HAS_REDIS && 'redis-server binary not installed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

class TestRedis {
  private proc?: ChildProcess;
  constructor(readonly port: number) {}
  async start(): Promise<void> {
    this.proc = spawn('redis-server', ['--port', String(this.port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      if (await this.ping()) return;
      await sleep(100);
    }
    throw new Error('test redis did not start');
  }
  stop(signal: NodeJS.Signals = 'SIGKILL'): void {
    this.proc?.kill(signal);
    this.proc = undefined;
  }
  private ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('node:net') as typeof import('node:net');
      const s = net.connect(this.port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
  }
}

interface Conv { id: string; tenantId: string; snoozedUntil: Date | null }

function fakePrisma(convs: Conv[], opts: { delayMs?: number; failTimes?: number } = {}) {
  const calls = { findFirst: [] as unknown[], updates: [] as unknown[], active: 0, maxActive: 0, failuresLeft: opts.failTimes ?? 0 };
  const prisma = {
    conversation: {
      async findFirst(args: { where: { id: string; tenantId: string } }) {
        calls.findFirst.push(args.where);
        calls.active++;
        calls.maxActive = Math.max(calls.maxActive, calls.active);
        try {
          if (opts.delayMs) await sleep(opts.delayMs);
          if (calls.failuresLeft > 0) { calls.failuresLeft--; throw new Error('database unavailable'); }
          return convs.find((c) => c.id === args.where.id && c.tenantId === args.where.tenantId) ?? null;
        } finally {
          calls.active--;
        }
      },
      async update(args: { where: { id: string }; data: { snoozedUntil: null } }) {
        calls.updates.push(args);
        const c = convs.find((x) => x.id === args.where.id)!;
        c.snoozedUntil = null;
        return { ...c, contact: {}, assignedTo: null, channel: null };
      },
    },
  };
  return { prisma: prisma as never, calls };
}

// Every worker a test starts is stopped when the test ends, pass or fail: an assertion that throws mid-test must not leave
// a worker (and its Redis connections) open, which would keep the whole test run from exiting.
const started: SnoozeWorker[] = [];
function track(worker: SnoozeWorker): SnoozeWorker {
  started.push(worker);
  return worker;
}

async function withEnv(fn: (ctx: { redis: TestRedis; connection: { host: string; port: number }; queue: Queue<SnoozeWakeJob> }) => Promise<void>) {
  const redis = new TestRedis(await freePort());
  await redis.start();
  const connection = { host: '127.0.0.1', port: redis.port };
  const queue = new Queue<SnoozeWakeJob>(QueueName.SNOOZE, { connection });
  // Realtime is not part of what is under test: record the emits instead of calling out.
  const realPost = axios.post;
  const emitted: unknown[] = [];
  (axios as unknown as { post: unknown }).post = async (_url: string, body: unknown) => { emitted.push(body); return { data: {} }; };
  (withEnv as unknown as { emitted: unknown[] }).emitted = emitted;
  try {
    await fn({ redis, connection, queue });
  } finally {
    await Promise.all(started.splice(0).map((w) => w.stop().catch(() => undefined)));
    (axios as unknown as { post: unknown }).post = realPost;
    await queue.close().catch(() => undefined);
    redis.stop();
  }
}
const lastEmitted = () => (withEnv as unknown as { emitted: unknown[] }).emitted;

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not reached in time');
    await sleep(25);
  }
}

const past = () => new Date(Date.now() - 60_000);
const wake = (conversationId: string, tenantId = 't1'): SnoozeWakeJob => ({ conversationId, tenantId });

test('a due snooze wake job clears the snooze and notifies realtime', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1'), { removeOnComplete: true });
    await waitFor(() => calls.updates.length === 1);
    await waitFor(() => lastEmitted().length === 1);
    assert.equal(convs[0]!.snoozedUntil, null);
    await worker.stop();
  });
});

test('tenant isolation: a job only ever reads and wakes a conversation of its own tenant', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 'other-tenant', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1', 't1'), { removeOnComplete: true });
    await waitFor(() => calls.findFirst.length === 1);
    await sleep(200);
    assert.deepEqual(calls.findFirst[0], { id: 'c1', tenantId: 't1' });
    assert.equal(calls.updates.length, 0);
    assert.notEqual(convs[0]!.snoozedUntil, null);
    await worker.stop();
  });
});

test('already woken or unknown conversations are skipped without error or emit', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: null }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1'), { removeOnComplete: true });
    await queue.add('wake', wake('missing'), { removeOnComplete: true });
    await waitFor(() => calls.findFirst.length === 2);
    await sleep(200);
    assert.equal(calls.updates.length, 0);
    assert.equal(lastEmitted().length, 0);
    await worker.stop();
  });
});

test('a stale job cannot cut short a snooze that was since extended', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: new Date(Date.now() + 3_600_000) }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1'), { removeOnComplete: true });
    await waitFor(() => calls.findFirst.length === 1);
    await sleep(200);
    assert.equal(calls.updates.length, 0);
    assert.notEqual(convs[0]!.snoozedUntil, null);
    await worker.stop();
  });
});

test('adding the same jobId twice (a re-snooze race) schedules one wake, not two', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await Promise.all([
      queue.add('wake', wake('c1'), { jobId: 'snooze-c1', delay: 100, removeOnComplete: true }),
      queue.add('wake', wake('c1'), { jobId: 'snooze-c1', delay: 100, removeOnComplete: true }),
    ]);
    await waitFor(() => calls.findFirst.length >= 1);
    await sleep(500);
    assert.equal(calls.findFirst.length, 1);
    assert.equal(calls.updates.length, 1);
    await worker.stop();
  });
});

test('a delayed job does not run early and does run once due', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    const added = Date.now();
    await queue.add('wake', wake('c1'), { delay: 800, removeOnComplete: true });
    await sleep(400);
    assert.equal(calls.findFirst.length, 0, 'ran before its delay elapsed');
    await waitFor(() => calls.updates.length === 1);
    assert.ok(Date.now() - added >= 750);
    await worker.stop();
  });
});

test('concurrency never exceeds the worker limit under a burst', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, tenantId: 't1', snoozedUntil: past() }));
    const { prisma, calls } = fakePrisma(convs, { delayMs: 60 });
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.addBulk(convs.map((c) => ({ name: 'wake', data: wake(c.id), opts: { removeOnComplete: true } })));
    await waitFor(() => calls.updates.length === 30, 20000);
    assert.ok(calls.maxActive <= 5, `max concurrent was ${calls.maxActive}`);
    assert.ok(calls.maxActive >= 2, 'jobs did not run concurrently at all');
    await worker.stop();
  });
});

test('graceful stop lets an in-flight job finish before it resolves', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs, { delayMs: 700 });
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1'), { removeOnComplete: true });
    await waitFor(() => calls.active === 1);
    await worker.stop();
    assert.equal(calls.updates.length, 1, 'stop returned while the job was still running');
  });
});

test('a failing database makes the job fail and be retried until it succeeds', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs, { failTimes: 2 });
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    await queue.add('wake', wake('c1'), { attempts: 4, backoff: { type: 'fixed', delay: 50 }, removeOnComplete: true });
    await waitFor(() => calls.updates.length === 1);
    assert.equal(calls.findFirst.length, 3, 'expected two failures then one success');
    await worker.stop();
  });
});

test('a realtime outage does not fail the wake (the snooze is still cleared)', { skip }, async () => {
  await withEnv(async ({ connection, queue }) => {
    (axios as unknown as { post: unknown }).post = async () => { throw new Error('realtime down'); };
    const convs: Conv[] = [{ id: 'c1', tenantId: 't1', snoozedUntil: past() }];
    const { prisma, calls } = fakePrisma(convs);
    const worker = track(new SnoozeWorker(prisma, connection));
    worker.start();
    const job = await queue.add('wake', wake('c1'));
    await waitFor(() => calls.updates.length === 1);
    await sleep(200);
    const state = await job.getState();
    assert.ok(state === 'completed', `job state was ${state}`);
    await worker.stop();
  });
});

test('Redis going away and coming back: no crash, no lost process, work resumes', { skip }, async () => {
  const uncaught: Error[] = [];
  const onUncaught = (e: Error) => { uncaught.push(e); };
  process.on('uncaughtException', onUncaught);
  const noisy = console.error;
  console.error = () => undefined; // BullMQ reports each failed reconnect here; the outage is deliberate.
  try {
    await withEnv(async ({ redis, connection, queue }) => {
      const convs: Conv[] = [
        { id: 'before', tenantId: 't1', snoozedUntil: past() },
        { id: 'after', tenantId: 't1', snoozedUntil: past() },
      ];
      const { prisma, calls } = fakePrisma(convs);
      const worker = track(new SnoozeWorker(prisma, connection));
      worker.start();
      await queue.add('wake', wake('before'), { removeOnComplete: true });
      await waitFor(() => calls.updates.length === 1);

      redis.stop('SIGKILL');
      await sleep(1500);
      await redis.start();
      await sleep(1500);

      // The queue handle held by the producer reconnects too.
      await queue.add('wake', wake('after'), { removeOnComplete: true });
      await waitFor(() => calls.updates.length === 2, 15000);
      assert.equal(uncaught.length, 0, `uncaught exception during outage: ${uncaught[0]?.message}`);
      await worker.stop();
    });
  } finally {
    console.error = noisy;
    process.off('uncaughtException', onUncaught);
  }
});
