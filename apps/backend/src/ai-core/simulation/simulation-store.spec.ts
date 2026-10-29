import { MemorySimulationStore, RedisSimulationStore, RESERVE_SCRIPT, RedisLike } from './simulation-store';

describe('MemorySimulationStore (the semantics the Redis store must match)', () => {
  const make = () => { let t = 0; return { store: new MemorySimulationStore(() => t), advance: (ms: number) => { t += ms; } }; };

  it('reserve is all-or-nothing: a blocked later counter does not consume an earlier one', async () => {
    const { store } = make();
    await store.reserve([{ key: 'b', limit: 1, ttlSeconds: 60 }]);
    const r = await store.reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }, { key: 'b', limit: 1, ttlSeconds: 60 }]);
    expect(r).toMatchObject({ ok: false, blockedIndex: 1, count: 1 });
    expect(await store.read(['a', 'b'])).toEqual([0, 1]);
  });

  it('counts up to the limit and no further; limit 0 allows nothing', async () => {
    const { store } = make();
    for (let i = 1; i <= 3; i++) expect(await store.reserve([{ key: 'k', limit: 3, ttlSeconds: 60 }])).toEqual({ ok: true, counts: [i] });
    expect((await store.reserve([{ key: 'k', limit: 3, ttlSeconds: 60 }])).ok).toBe(false);
    expect((await store.reserve([{ key: 'z', limit: 0, ttlSeconds: 60 }])).ok).toBe(false);
  });

  it('a counter expires with its window and starts again', async () => {
    const { store, advance } = make();
    await store.reserve([{ key: 'k', limit: 1, ttlSeconds: 10 }]);
    expect((await store.reserve([{ key: 'k', limit: 1, ttlSeconds: 10 }])).ok).toBe(false);
    advance(10_001);
    expect((await store.reserve([{ key: 'k', limit: 1, ttlSeconds: 10 }])).ok).toBe(true);
  });

  it('the window is fixed from the first increment (later increments do not extend it)', async () => {
    const { store, advance } = make();
    await store.reserve([{ key: 'k', limit: 5, ttlSeconds: 10 }]);
    advance(6_000);
    await store.reserve([{ key: 'k', limit: 5, ttlSeconds: 10 }]);
    advance(5_000);
    expect(await store.read(['k'])).toEqual([0]);
  });

  it('claim succeeds once, then fails until the key expires; set and del behave', async () => {
    const { store, advance } = make();
    expect(await store.claim('i', 'x', 10)).toBe(true);
    expect(await store.claim('i', 'y', 10)).toBe(false);
    expect(await store.get('i')).toBe('x');
    advance(10_001);
    expect(await store.get('i')).toBeNull();
    expect(await store.claim('i', 'z', 10)).toBe(true);
    await store.set('i', 'w', 10);
    expect(await store.get('i')).toBe('w');
    await store.del('i');
    expect(await store.get('i')).toBeNull();
  });
});

describe('RedisSimulationStore (command shapes; real Redis behaviour is covered by the opt-in Redis spec)', () => {
  const fake = () => {
    const calls: Array<[string, unknown[]]> = [];
    const redis: RedisLike = {
      eval: async (...a) => { calls.push(['eval', a]); return fake.evalResult; },
      mget: async (...k) => { calls.push(['mget', k]); return ['3', null]; },
      get: async (k) => { calls.push(['get', [k]]); return 'v'; },
      set: async (...a) => { calls.push(['set', a]); return fake.setResult; },
      del: async (...k) => { calls.push(['del', k]); return 1; },
    };
    return { redis, calls };
  };
  fake.evalResult = [1, 0, 1, 1] as unknown;
  fake.setResult = 'OK' as unknown;

  it('sends one script with every key and a limit and ttl per key', async () => {
    const { redis, calls } = fake();
    fake.evalResult = [1, 0, 1, 4];
    const r = await new RedisSimulationStore(async () => redis).reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }, { key: 'b', limit: 9, ttlSeconds: 120 }]);
    expect(r).toEqual({ ok: true, counts: [1, 4] });
    expect(calls[0]).toEqual(['eval', [RESERVE_SCRIPT, 2, 'a', 'b', 5, 60, 9, 120]]);
  });

  it('reads a refusal from the script', async () => {
    const { redis } = fake();
    fake.evalResult = [0, 2, 9, 1234];
    expect(await new RedisSimulationStore(async () => redis).reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }, { key: 'b', limit: 9, ttlSeconds: 120 }])).toEqual({ ok: false, blockedIndex: 1, count: 9, ttlSeconds: 1234 });
  });

  it('claim is SET NX EX and reports whether it created the key', async () => {
    const { redis, calls } = fake();
    const store = new RedisSimulationStore(async () => redis);
    fake.setResult = 'OK';
    expect(await store.claim('k', 'v', 30)).toBe(true);
    fake.setResult = null;
    expect(await store.claim('k', 'v', 30)).toBe(false);
    expect(calls[0]).toEqual(['set', ['k', 'v', 'EX', 30, 'NX']]);
  });

  it('read treats a missing key as 0, set carries a ttl, and nothing is sent for no work', async () => {
    const { redis, calls } = fake();
    const store = new RedisSimulationStore(async () => redis);
    expect(await store.read(['a', 'b'])).toEqual([3, 0]);
    await store.set('k', 'v', 10);
    expect(calls[1]).toEqual(['set', ['k', 'v', 'EX', 10]]);
    expect(await store.reserve([])).toEqual({ ok: true, counts: [] });
    expect(await store.read([])).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('the script checks every counter before incrementing any (all-or-nothing) and never leaves a counter without an expiry', () => {
    expect(RESERVE_SCRIPT.indexOf("return {0, i, c")).toBeLessThan(RESERVE_SCRIPT.indexOf("redis.call('INCR'"));
    expect(RESERVE_SCRIPT).toContain("redis.call('EXPIRE'");
    expect(RESERVE_SCRIPT).toMatch(/TTL', KEYS\[i\]\) < 0/);
  });
});

describe('RedisSimulationStore: a store that never answers fails within the bound instead of hanging the request', () => {
  const never = () => new Promise<never>(() => undefined);
  const hung: RedisLike = { eval: never, mget: never, get: never, set: never, del: never };

  it.each([
    ['reserve', (s: RedisSimulationStore) => s.reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }])],
    ['read', (s: RedisSimulationStore) => s.read(['a'])],
    ['claim', (s: RedisSimulationStore) => s.claim('a', 'v', 60)],
    ['get', (s: RedisSimulationStore) => s.get('a')],
    ['set', (s: RedisSimulationStore) => s.set('a', 'v', 60)],
    ['del', (s: RedisSimulationStore) => s.del('a')],
  ])('%s rejects when the command never returns', async (_n, run) => {
    const started = Date.now();
    await expect(run(new RedisSimulationStore(async () => hung, 50))).rejects.toThrow(/did not respond within 50 ms/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects when the connection itself never becomes ready (Redis down at the first command)', async () => {
    await expect(new RedisSimulationStore(never, 50).reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }])).rejects.toThrow(/did not respond/);
  });

  it('a prompt answer is returned untouched and leaves no pending timer', async () => {
    const redis: RedisLike = { ...hung, eval: async () => [1, 0, 1, 1] };
    jest.useFakeTimers();
    try {
      await expect(new RedisSimulationStore(async () => redis, 50).reserve([{ key: 'a', limit: 5, ttlSeconds: 60 }])).resolves.toEqual({ ok: true, counts: [1, 1] });
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });
});
