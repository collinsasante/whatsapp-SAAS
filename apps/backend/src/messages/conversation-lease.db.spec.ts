/**
 * Cross-replica AI lease against a REAL Postgres: two independent ConversationLease instances (each with its own connection pool, standing in for two
 * backend replicas) compete for the same conversation. Skipped unless AILEASE_TEST_DATABASE_URL is set (database name must contain test/scratch/tmp).
 */
import { PrismaClient } from '@prisma/client';
import { ConversationLease, LeaseTimeoutError } from './conversation-lease';

const url = process.env['AILEASE_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('AILEASE_TEST_DATABASE_URL must name a throwaway database.');
const describeDb = url ? describe : describe.skip;

describeDb('ConversationLease (two replicas, real database)', () => {
  const mk = () => new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const pA = mk(); const pB = mk();
  const A = new ConversationLease(pA as never); const B = new ConversationLease(pB as never);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  beforeEach(async () => { await pA.$executeRawUnsafe('TRUNCATE ai_conversation_leases'); });
  afterAll(async () => { await pA.$disconnect(); await pB.$disconnect(); });

  it('never lets two replicas run the same conversation at once, and every turn still runs exactly once (no lost or duplicated work)', async () => {
    let active = 0, maxActive = 0; const order: string[] = [];
    const turn = (name: string) => async () => { active++; maxActive = Math.max(maxActive, active); order.push(`start:${name}`); await sleep(60); order.push(`end:${name}`); active--; return name; };
    const results = await Promise.all([
      A.withLease('t1', 'conv-1', turn('A1'), { pollMs: 10 }), B.withLease('t1', 'conv-1', turn('B1'), { pollMs: 10 }),
      A.withLease('t1', 'conv-1', turn('A2'), { pollMs: 10 }), B.withLease('t1', 'conv-1', turn('B2'), { pollMs: 10 }),
      A.withLease('t1', 'conv-1', turn('A3'), { pollMs: 10 }), B.withLease('t1', 'conv-1', turn('B3'), { pollMs: 10 }),
    ]);
    expect(maxActive).toBe(1);
    expect(results.sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    for (let i = 0; i < order.length; i += 2) expect(order[i]!.startsWith('start:') && order[i + 1] === order[i]!.replace('start', 'end')).toBe(true); // strictly start,end,start,end
    expect(await pA.$queryRaw`SELECT 1 FROM ai_conversation_leases`).toHaveLength(0);                                                                        // released
  });

  it('different conversations are not serialised against each other', async () => {
    const t0 = Date.now();
    await Promise.all([A.withLease('t1', 'conv-a', () => sleep(150)), B.withLease('t1', 'conv-b', () => sleep(150))]);
    expect(Date.now() - t0).toBeLessThan(290);
  });

  it('a crashed holder cannot wedge a conversation: once its lease expires another replica takes over', async () => {
    expect(await A.acquire('t1', 'conv-crash', 'dead-replica', 200)).toBe(true);   // never released, never renewed
    expect(await B.acquire('t1', 'conv-crash', 'live', 5000)).toBe(false);         // still held
    await sleep(260);
    expect(await B.acquire('t1', 'conv-crash', 'live', 5000)).toBe(true);          // expired -> taken over
    expect(await A.renew('conv-crash', 'dead-replica', 5000)).toBe(false);         // the old owner can no longer renew or release someone else's lease
    await A.release('conv-crash', 'dead-replica');
    expect(await pA.$queryRaw<Array<{ owner: string }>>`SELECT owner FROM ai_conversation_leases WHERE conversation_id = 'conv-crash'`).toEqual([{ owner: 'live' }]);
  });

  it('a long turn keeps its lease by renewing it, so a slow provider call is not run twice', async () => {
    let bRan = false;
    const long = A.withLease('t1', 'conv-long', () => sleep(1700), { ttlMs: 600, pollMs: 20 });           // lease would expire 3x over without renewals
    await sleep(100);
    const waiter = B.withLease('t1', 'conv-long', async () => { bRan = true; }, { ttlMs: 600, pollMs: 20, maxWaitMs: 800 }).catch((e) => e);
    expect(await waiter).toBeInstanceOf(LeaseTimeoutError);
    expect(bRan).toBe(false);
    await long;
  });

  it('a waiter that times out skips its turn instead of running unsynchronised', async () => {
    expect(await A.acquire('t1', 'conv-busy', 'holder', 30_000)).toBe(true);
    await expect(B.withLease('t1', 'conv-busy', async () => 'ran', { maxWaitMs: 150, pollMs: 20 })).rejects.toBeInstanceOf(LeaseTimeoutError);
  });

  it('an error inside the turn still releases the lease', async () => {
    await expect(A.withLease('t1', 'conv-err', async () => { throw new Error('provider exploded'); })).rejects.toThrow('provider exploded');
    expect(await B.acquire('t1', 'conv-err', 'next', 1000)).toBe(true);
  });

  it('fails open to the in-process lock when the lease table is unavailable (migration not yet applied)', async () => {
    const broken = new ConversationLease({ $queryRaw: async () => { throw new Error('relation does not exist'); } } as never);
    expect(await broken.withLease('t1', 'conv-x', async () => 'ran anyway')).toBe('ran anyway');
  });
});
