import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { RedisLike, RedisSimulationStore } from '../src/ai-core/simulation/simulation-store';
import { SimulationLimitReachedException, SimulationLimitsService } from '../src/ai-core/simulation/simulation-limits.service';

/**
 * The simulation limits against a REAL Redis. The unit tests prove the logic with an in-memory twin; this proves the property the
 * feature exists for, that concurrent requests cannot take more than the limit, on Redis itself.
 *
 * The connections are opened the way production opens its one: through a BullMQ Queue handle (`Queue.client`). Concurrency is spread
 * over many SEPARATE connections, so it is genuine contention between clients, not one client pipelining.
 *
 * SAFETY: writes keys under the `verz:aisim:` prefix for random tenant ids and deletes only those. Runs ONLY when
 * AI_LIMITS_REDIS_TESTS=1 AND AI_LIMITS_REDIS_URL points at localhost; otherwise the whole suite is skipped.
 */
function redisTarget(): { host: string; port: number } | null {
  if (process.env.AI_LIMITS_REDIS_TESTS !== '1') return null;
  try {
    const url = new URL(process.env.AI_LIMITS_REDIS_URL ?? '');
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) return null;
    return { host: url.hostname, port: Number(url.port || 6379) };
  } catch {
    return null;
  }
}
const target = redisTarget();
const suite = target ? describe : describe.skip;

suite('simulation limits against a real Redis (disposable instance only)', () => {
  jest.setTimeout(60_000);

  const CONNECTIONS = 8;
  const queues: Queue[] = [];
  const stores: RedisSimulationStore[] = [];
  const tenants: string[] = [];
  let admin: RedisLike;

  const tenant = () => { const t = `it${randomUUID().replace(/-/g, '').slice(0, 24)}`; tenants.push(t); return t; };
  const day = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
  /** Spread calls across the separate connections. */
  const pick = <T>(arr: T[], i: number) => arr[i % arr.length];

  beforeAll(async () => {
    for (let i = 0; i < CONNECTIONS; i++) {
      const q = new Queue(`sim-limits-it-${i}`, { connection: { host: target!.host, port: target!.port } });
      queues.push(q);
      stores.push(new RedisSimulationStore(() => q.client as unknown as Promise<RedisLike>));
    }
    admin = (await queues[0].client) as unknown as RedisLike;
  });

  afterAll(async () => {
    // Delete only the keys this suite created (random tenant ids), then close every connection.
    const client = (await queues[0].client) as unknown as { scan: (c: string, ...a: Array<string | number>) => Promise<[string, string[]]>; del: (...k: string[]) => Promise<number> };
    for (const t of tenants) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `verz:aisim:v1:*${t}*`, 'COUNT', 500);
        cursor = next;
        if (keys.length) await client.del(...keys);
      } while (cursor !== '0');
    }
    await Promise.all(queues.map((q) => q.close()));
  });

  describe('RedisSimulationStore', () => {
    it('200 simultaneous reservations from 8 connections against a limit of 25 take exactly 25', async () => {
      const key = `verz:aisim:v1:t:${tenant()}:d:${day()}:requests`;
      const results = await Promise.all(Array.from({ length: 200 }, (_v, i) => pick(stores, i).reserve([{ key, limit: 25, ttlSeconds: 60 }])));
      expect(results.filter((r) => r.ok)).toHaveLength(25);
      expect(results.filter((r) => !r.ok)).toHaveLength(175);
      expect(await stores[0].read([key])).toEqual([25]);
    });

    it('is ALL-OR-NOTHING under contention: refused requests do not consume the other counter', async () => {
      const t = tenant();
      const wide = `verz:aisim:v1:u:${t}:wide:m:1`;
      const narrow = `verz:aisim:v1:t:${t}:d:${day()}:requests`;
      const results = await Promise.all(Array.from({ length: 100 }, (_v, i) => pick(stores, i).reserve([
        { key: wide, limit: 1000, ttlSeconds: 60 }, { key: narrow, limit: 10, ttlSeconds: 60 },
      ])));
      expect(results.filter((r) => r.ok)).toHaveLength(10);
      expect(await stores[0].read([wide, narrow])).toEqual([10, 10]); // not [100, 10]
    });

    it('a limit of 0 allows nothing and creates no counter', async () => {
      const key = `verz:aisim:v1:t:${tenant()}:d:${day()}:requests`;
      expect((await stores[0].reserve([{ key, limit: 0, ttlSeconds: 60 }])).ok).toBe(false);
      expect(await stores[0].read([key])).toEqual([0]);
    });

    it('the counter always has an expiry (no key can live forever) and it does not drift upward on later increments', async () => {
      const key = `verz:aisim:v1:t:${tenant()}:d:${day()}:requests`;
      await stores[0].reserve([{ key, limit: 10, ttlSeconds: 100 }]);
      const ttl1 = Number(await (admin as unknown as { ttl: (k: string) => Promise<number> }).ttl(key));
      expect(ttl1).toBeGreaterThan(0);
      expect(ttl1).toBeLessThanOrEqual(100);
      await stores[1].reserve([{ key, limit: 10, ttlSeconds: 100 }]);
      const ttl2 = Number(await (admin as unknown as { ttl: (k: string) => Promise<number> }).ttl(key));
      expect(ttl2).toBeLessThanOrEqual(ttl1);
    });

    it('a window expires and the counter starts again', async () => {
      const key = `verz:aisim:v1:t:${tenant()}:d:${day()}:requests`;
      expect((await stores[0].reserve([{ key, limit: 1, ttlSeconds: 1 }])).ok).toBe(true);
      expect((await stores[0].reserve([{ key, limit: 1, ttlSeconds: 1 }])).ok).toBe(false);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await stores[0].reserve([{ key, limit: 1, ttlSeconds: 1 }])).ok).toBe(true);
    });

    it('a refusal reports the count and the remaining time to live of the blocked counter', async () => {
      const key = `verz:aisim:v1:t:${tenant()}:d:${day()}:requests`;
      await stores[0].reserve([{ key, limit: 1, ttlSeconds: 90 }]);
      const r = await stores[0].reserve([{ key, limit: 1, ttlSeconds: 90 }]);
      expect(r).toMatchObject({ ok: false, blockedIndex: 0, count: 1 });
      expect((r as { ttlSeconds: number }).ttlSeconds).toBeGreaterThan(0);
    });

    it('claim: 50 simultaneous claims of one key succeed exactly once', async () => {
      const key = `verz:aisim:v1:i:${tenant()}:u:request-1`;
      const claims = await Promise.all(Array.from({ length: 50 }, (_v, i) => pick(stores, i).claim(key, 'pending', 60)));
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it('get, set and del round-trip, and set overwrites with a new expiry', async () => {
      const key = `verz:aisim:v1:i:${tenant()}:u:request-2`;
      expect(await stores[0].get(key)).toBeNull();
      await stores[0].claim(key, 'pending', 60);
      await stores[1].set(key, '{"state":"done"}', 60);
      expect(await stores[2].get(key)).toBe('{"state":"done"}');
      await stores[3].del(key);
      expect(await stores[0].get(key)).toBeNull();
    });

    it('stays in its own namespace: it creates no BullMQ keys', async () => {
      const t = tenant();
      await stores[0].reserve([{ key: `verz:aisim:v1:t:${t}:d:${day()}:requests`, limit: 5, ttlSeconds: 60 }]);
      const client = admin as unknown as { keys: (p: string) => Promise<string[]> };
      expect((await client.keys(`*${t}*`)).every((k) => k.startsWith('verz:aisim:'))).toBe(true);
    });
  });

  describe('SimulationLimitsService on Redis', () => {
    const service = (env: Record<string, string>, i = 0) => new SimulationLimitsService({ get: (k: string) => env[k] } as never, stores[i % stores.length]);
    const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

    it('100 simultaneous requests from 8 connections against a budget of 10 run the work exactly 10 times', async () => {
      const t = tenant();
      const services = stores.map((_s, i) => service({ AI_SIM_DAILY_REQUESTS: '10', AI_SIM_USER_PER_MINUTE: '1000' }, i));
      let ran = 0;
      const out = await Promise.all(Array.from({ length: 100 }, (_v, i) => pick(services, i).execute({ tenantId: t, userId: `user-${i % 9}`, kind: 'test-chat' }, async () => { ran++; await new Promise((r) => setTimeout(r, 5)); return i; })
        .then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : `error:${String(e)}`))));
      expect(ran).toBe(10);
      expect(out.filter((x) => x === 'ok')).toHaveLength(10);
      expect(out.filter((x) => x === 'refused')).toHaveLength(90);
      expect(out.filter((x) => x.startsWith('error'))).toEqual([]);
    });

    it('one user cannot exceed the per-minute rate however many connections they use', async () => {
      const t = tenant();
      const services = stores.map((_s, i) => service({ AI_SIM_USER_PER_MINUTE: '4', AI_SIM_DAILY_REQUESTS: '1000' }, i));
      let ran = 0;
      await Promise.all(Array.from({ length: 40 }, (_v, i) => pick(services, i).execute({ tenantId: t, userId: 'one-user', kind: 'test-chat' }, async () => { ran++; }).catch(() => undefined)));
      // The window is the calendar minute; if the run straddles a minute boundary a second window is legitimately opened.
      expect(ran).toBeLessThanOrEqual(8);
      expect(ran).toBeGreaterThanOrEqual(4);
    });

    it('20 simultaneous retries of one request id, from different connections, run the work once and cost one unit', async () => {
      const t = tenant();
      const services = stores.map((_s, i) => service({}, i));
      let ran = 0;
      const out = await Promise.all(Array.from({ length: 20 }, (_v, i) => pick(services, i).execute({ tenantId: t, userId: 'u1', kind: 'test-chat', requestId: 'request-real-redis-1' }, async () => { ran++; await new Promise((r) => setTimeout(r, 30)); return 'v'; })
        .then((r) => (r.replayed ? 'replay' : 'ran'), () => 'in-progress-or-refused')));
      expect(ran).toBe(1);
      expect(out.filter((x) => x === 'ran')).toHaveLength(1);
      const later = await service({}, 3).execute({ tenantId: t, userId: 'u1', kind: 'test-chat', requestId: 'request-real-redis-1' }, async () => { ran++; return 'again'; });
      expect(later).toEqual({ value: 'v', replayed: true });
      expect(ran).toBe(1);
      expect((await service({}).usage(t, 'u1')).used.requestsToday).toBe(1);
    });

    it('tenants are isolated on the real store', async () => {
      const a = tenant();
      const b = tenant();
      const svc = service({ AI_SIM_DAILY_REQUESTS: '2', AI_SIM_USER_PER_MINUTE: '1000' });
      await svc.execute({ tenantId: a, userId: 'u', kind: 'test-chat' }, async () => 1);
      await svc.execute({ tenantId: a, userId: 'u', kind: 'test-chat' }, async () => 2);
      expect(await caught(svc.execute({ tenantId: a, userId: 'u', kind: 'test-chat' }, async () => 3))).toBeInstanceOf(SimulationLimitReachedException);
      await expect(svc.execute({ tenantId: b, userId: 'u', kind: 'test-chat' }, async () => 4)).resolves.toMatchObject({ replayed: false });
    });

    it('the simulated-evaluation budget is exact under contention: 60 attempts against 7 grade exactly 7', async () => {
      const t = tenant();
      const services = stores.map((_s, i) => service({ AI_SIM_DAILY_EVALUATIONS: '7' }, i));
      const r = await Promise.all(Array.from({ length: 60 }, (_v, i) => pick(services, i).reserveEvaluation(t)));
      expect(r.filter(Boolean)).toHaveLength(7);
    });

    it('the evaluation-run budget is exact under contention', async () => {
      const t = tenant();
      const services = stores.map((_s, i) => service({ AI_SIM_DAILY_EVAL_RUNS: '3' }, i));
      const r = await Promise.all(Array.from({ length: 30 }, (_v, i) => pick(services, i).reserveEvalRun(t).then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : 'error'))));
      expect(r.filter((x) => x === 'ok')).toHaveLength(3);
      expect(r).not.toContain('error');
    });

    it('the usage report reads the real counters and the real reset time', async () => {
      const t = tenant();
      const svc = service({});
      await svc.execute({ tenantId: t, userId: 'u', kind: 'test-chat' }, async () => 1);
      const u = await svc.usage(t, 'u');
      expect(u.used).toMatchObject({ requestsToday: 1, userRequestsThisMinute: 1 });
      expect(new Date(u.resetsAt).getUTCHours()).toBe(0);
      expect(new Date(u.resetsAt).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
