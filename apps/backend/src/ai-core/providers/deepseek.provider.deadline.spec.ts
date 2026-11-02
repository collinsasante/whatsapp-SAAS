import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

// REAL axios and a real local HTTP server (nothing is mocked except the URL constant): the point is to prove that the total
// deadline cancels a request that axios's own `timeout` would NOT stop, i.e. one that has already received response headers and is
// then kept alive. DeepSeek documents this behaviour for non-streaming requests (empty keep-alive lines while it waits).
let baseUrl = '';
jest.mock('../../common/deepseek', () => ({
  get DEEPSEEK_API_URL() { return baseUrl; },
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
}));

import { DeepSeekProvider } from './deepseek.provider';

describe('DeepSeekProvider total deadline against a real server', () => {
  let server: http.Server;
  let requests = 0;
  let mode: 'headers-then-silence' | 'never-answer' | 'ok' = 'ok';
  const open = new Set<import('node:net').Socket>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests++;
      req.resume();
      if (mode === 'never-answer') return;
      if (mode === 'headers-then-silence') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const keepAlive = setInterval(() => res.write('\n'), 20); // bytes keep arriving, so the socket is never idle
        res.on('close', () => clearInterval(keepAlive));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'deepseek-v4-flash', choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    });
    server.on('connection', (s) => { open.add(s); s.on('close', () => open.delete(s)); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });
  afterAll(async () => {
    for (const s of open) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => { requests = 0; });

  const REQ = { modelKey: 'deepseek-v4-flash', messages: [{ role: 'user' as const, content: 'hi' }] };

  it('cancels a response that has started but never finishes, although the per-attempt timeout is far longer', async () => {
    mode = 'headers-then-silence';
    const startedAt = Date.now();

    await expect(new DeepSeekProvider().complete({ ...REQ, timeoutMs: 20_000, deadlineMs: 300, maxAttempts: 1 }))
      .rejects.toMatchObject({ code: 'timeout', uncertainOutcome: true });

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(requests).toBe(1);
  });

  it('cancels a request that never gets any response', async () => {
    mode = 'never-answer';
    const startedAt = Date.now();

    await expect(new DeepSeekProvider().complete({ ...REQ, timeoutMs: 20_000, deadlineMs: 200, maxAttempts: 1 }))
      .rejects.toMatchObject({ code: 'timeout' });

    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('returns a normal answer and its provider-reported usage when it arrives before the deadline', async () => {
    mode = 'ok';

    const result = await new DeepSeekProvider().complete({ ...REQ, deadlineMs: 5_000, maxAttempts: 1 });

    expect(result).toMatchObject({ content: 'hello', usage: { inputTokens: 3, outputTokens: 1 }, attemptsUsed: 1 });
  });
});
