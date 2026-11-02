import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import * as jwt from 'jsonwebtoken';

// socket.io-client is a frontend dependency; borrowing it avoids adding a package to this service just for a test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { io: connect } = require('../../frontend/node_modules/socket.io-client') as { io: (url: string, opts: object) => TestSocket };
interface TestSocket { on(e: string, cb: (...a: unknown[]) => void): void; emit(e: string, ...a: unknown[]): void; close(): void; once(e: string, cb: (...a: unknown[]) => void): void }

const SECRET = 'test-secret-for-gateway-isolation';
process.env['JWT_SECRET'] = SECRET;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SocketGateway } = require('./gateway') as typeof import('./gateway');

let http: HttpServer;
let io: Server;
let url: string;
let deliver: (raw: string) => void = () => undefined;

const token = (tenantId: string, sub: string, secret = SECRET) => jwt.sign({ sub, tenantId, role: 'ADMIN', email: `${sub}@x.test` }, secret, { expiresIn: 60 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const open = (t: string | null) => new Promise<TestSocket>((resolve, reject) => {
  const s = connect(url, { auth: t ? { token: t } : {}, transports: ['websocket'], reconnection: false });
  s.once('connect', () => resolve(s));
  s.once('connect_error', (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
});
const collect = (s: TestSocket, event: string) => { const got: unknown[] = []; s.on(event, (p: unknown) => got.push(p)); return got; };
const publish = (event: string, payload: Record<string, unknown>) => deliver(JSON.stringify({ event, payload }));

before(async () => {
  http = createServer();
  io = new Server(http, { transports: ['websocket'] });
  const redis = { subscribe: () => undefined, on: (_e: string, handler: (c: string, raw: string) => void) => { deliver = (raw) => handler('realtime:events', raw); } };
  new SocketGateway(io, redis as never).initialize();
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
after(() => { io.close(); http.close(); });

test('connections without a valid token are refused', async () => {
  await assert.rejects(open(null), /token required/i);
  await assert.rejects(open(token('tenant-a', 'u1', 'some-other-secret')), /invalid/i);
});

test('two workspaces that use the SAME conversation id never see each other\'s conversation events', async () => {
  const a = await open(token('tenant-a', 'user-a'));
  const b = await open(token('tenant-b', 'user-b'));
  const gotA = collect(a, 'new_message');
  const gotB = collect(b, 'new_message');
  a.emit('join_conversation', 'conv-1');
  b.emit('join_conversation', 'conv-1');
  await sleep(150);
  publish('new_message', { tenantId: 'tenant-a', conversationId: 'conv-1', message: 'secret for A' });
  await sleep(250);
  assert.equal(gotA.length, 1, 'tenant A receives its own event');
  assert.equal(JSON.stringify(gotB).includes('secret for A'), false, 'tenant B must not receive tenant A\'s event');
  assert.equal(gotB.length, 0);
  a.close(); b.close();
});

test('a user who joins another workspace\'s conversation id still receives nothing from it', async () => {
  const a = await open(token('tenant-a', 'user-a'));
  const attacker = await open(token('tenant-b', 'attacker'));
  const got = collect(attacker, 'new_message');
  attacker.emit('join_conversation', 'conv-only-a-has');
  a.emit('join_conversation', 'conv-only-a-has');
  await sleep(150);
  publish('new_message', { tenantId: 'tenant-a', conversationId: 'conv-only-a-has', message: 'private' });
  await sleep(250);
  assert.equal(got.length, 0);
  a.close(); attacker.close();
});

test('workspace-wide events reach only that workspace, and typing indicators stay inside it', async () => {
  const a1 = await open(token('tenant-a', 'a1'));
  const a2 = await open(token('tenant-a', 'a2'));
  const b = await open(token('tenant-b', 'b1'));
  const gotA2 = collect(a2, 'conversation_update');
  const gotB = collect(b, 'conversation_update');
  const typingB = collect(b, 'typing_start');
  const typingA2 = collect(a2, 'typing_start');
  for (const s of [a1, a2, b]) s.emit('join_conversation', 'shared-id');
  await sleep(150);
  publish('conversation_update', { tenantId: 'tenant-a', status: 'OPEN' });
  a1.emit('typing_start', { conversationId: 'shared-id' });
  await sleep(250);
  assert.equal(gotA2.length, 1);
  assert.equal(gotB.length, 0);
  assert.equal(typingA2.length, 1, 'a colleague in the same workspace sees the typing indicator');
  assert.equal(typingB.length, 0, 'another workspace does not');
  a1.close(); a2.close(); b.close();
});

test('personal user events reach only that user, and events with no workspace are dropped', async () => {
  const u1 = await open(token('tenant-a', 'user-1'));
  const u2 = await open(token('tenant-a', 'user-2'));
  const g1 = collect(u1, 'notification');
  const g2 = collect(u2, 'notification');
  const any2 = collect(u2, 'orphan');
  publish('notification', { userId: 'user-1', data: { n: 1 } });
  publish('orphan', { conversationId: 'x', message: 'no tenant' });
  await sleep(250);
  assert.equal(g1.length, 1);
  assert.equal(g2.length, 0);
  assert.equal(any2.length, 0);
  u1.close(); u2.close();
});
