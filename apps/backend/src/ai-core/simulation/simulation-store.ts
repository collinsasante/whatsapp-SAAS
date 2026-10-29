/**
 * The shared, ATOMIC state behind the simulation limits. Two implementations: Redis (production) and an in-memory twin with the same
 * semantics (unit tests only). Redis is used because it is the only store that is both shared across backend replicas and atomic:
 * counting database rows is read-then-act, so concurrent requests would all pass the check, and a row lock held across a 20-second
 * provider call would serialise a whole tenant.
 */
export interface CounterSpec {
  key: string;
  /** The counter may not be incremented once it has reached this value. 0 means nothing is allowed. */
  limit: number;
  /** Lifetime of the counter's window, set when the counter is first created. */
  ttlSeconds: number;
}

export type ReserveResult =
  | { ok: true; counts: number[] }
  | { ok: false; blockedIndex: number; count: number; ttlSeconds: number };

export interface SimulationStore {
  /** ALL-OR-NOTHING: if any counter is at its limit nothing is incremented and the first blocked counter is reported. */
  reserve(specs: CounterSpec[]): Promise<ReserveResult>;
  read(keys: string[]): Promise<number[]>;
  /** SET key value NX EX ttl: true if this caller created it. */
  claim(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** The few Redis commands used; satisfied by the ioredis client BullMQ already holds. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

/**
 * KEYS[i] is counter i, ARGV[2i-1] its limit and ARGV[2i] its TTL. Redis runs a script without interleaving any other command, so the
 * check and the increments are one atomic step: N concurrent callers can never take more than `limit` slots between them, and a
 * caller blocked on a later counter does not consume an earlier one.
 */
export const RESERVE_SCRIPT = `
for i = 1, #KEYS do
  local c = tonumber(redis.call('GET', KEYS[i]) or '0')
  if c >= tonumber(ARGV[2 * i - 1]) then
    return {0, i, c, redis.call('TTL', KEYS[i])}
  end
end
local out = {1, 0}
for i = 1, #KEYS do
  local c = redis.call('INCR', KEYS[i])
  if c == 1 or redis.call('TTL', KEYS[i]) < 0 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[2 * i])) end
  out[#out + 1] = c
end
return out
`;

export class RedisSimulationStore implements SimulationStore {
  /** Takes a provider so the connection is resolved lazily (BullMQ connects on first use). */
  constructor(private readonly client: () => Promise<RedisLike>) {}

  async reserve(specs: CounterSpec[]): Promise<ReserveResult> {
    if (specs.length === 0) return { ok: true, counts: [] };
    const redis = await this.client();
    const args: Array<string | number> = [];
    for (const s of specs) args.push(s.limit, s.ttlSeconds);
    const raw = (await redis.eval(RESERVE_SCRIPT, specs.length, ...specs.map((s) => s.key), ...args)) as number[];
    if (raw[0] === 1) return { ok: true, counts: raw.slice(2).map(Number) };
    return { ok: false, blockedIndex: Number(raw[1]) - 1, count: Number(raw[2]), ttlSeconds: Number(raw[3]) };
  }

  async read(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const redis = await this.client();
    return (await redis.mget(...keys)).map((v) => (v === null ? 0 : Number(v)));
  }

  async claim(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const redis = await this.client();
    return (await redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async get(key: string): Promise<string | null> {
    return (await this.client()).get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await (await this.client()).set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await (await this.client()).del(key);
  }
}

/** Same semantics, single process. For unit tests only: JavaScript's event loop makes each call atomic, which proves the logic but NOT Redis. */
export class MemorySimulationStore implements SimulationStore {
  private readonly data = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string): { value: string; expiresAt: number } | undefined {
    const e = this.data.get(key);
    if (e && e.expiresAt <= this.now()) { this.data.delete(key); return undefined; }
    return e;
  }

  async reserve(specs: CounterSpec[]): Promise<ReserveResult> {
    for (let i = 0; i < specs.length; i++) {
      const e = this.live(specs[i].key);
      const c = e ? Number(e.value) : 0;
      if (c >= specs[i].limit) return { ok: false, blockedIndex: i, count: c, ttlSeconds: e ? Math.max(1, Math.ceil((e.expiresAt - this.now()) / 1000)) : specs[i].ttlSeconds };
    }
    const counts: number[] = [];
    for (const s of specs) {
      const e = this.live(s.key);
      const next = (e ? Number(e.value) : 0) + 1;
      this.data.set(s.key, { value: String(next), expiresAt: e ? e.expiresAt : this.now() + s.ttlSeconds * 1000 });
      counts.push(next);
    }
    return { ok: true, counts };
  }

  async read(keys: string[]): Promise<number[]> { return keys.map((k) => Number(this.live(k)?.value ?? 0)); }
  async claim(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.data.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }
  async get(key: string): Promise<string | null> { return this.live(key)?.value ?? null; }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> { this.data.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 }); }
  async del(key: string): Promise<void> { this.data.delete(key); }
}
