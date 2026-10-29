import { BadRequestException, ConflictException } from '@nestjs/common';
import { DEFAULT_SIMULATION_LIMITS } from './simulation-limits.config';
import { SimulationLimitReachedException, SimulationLimitsService, SimulationUnavailableException } from './simulation-limits.service';
import { CounterSpec, MemorySimulationStore, SimulationStore } from './simulation-store';

/** A controllable clock shared by the service and the store, so windows and expiry are exact. */
function harness(env: Record<string, string> = {}, start = '2026-10-29T10:00:30.000Z') {
  let t = new Date(start).getTime();
  const clock = { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
  const store = new MemorySimulationStore(() => t);
  const service = new SimulationLimitsService({ get: (k: string) => env[k] } as never, store, clock.now);
  return { service, store, clock };
}
const T1 = 'tenant-1';
const T2 = 'tenant-2';
const U1 = 'user-1';
const args = (over: Partial<Parameters<SimulationLimitsService['execute']>[0]> = {}) => ({ tenantId: T1, userId: U1, kind: 'test-chat' as const, ...over });
const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

describe('SimulationLimitsService', () => {
  describe('input rules', () => {
    it('accepts a message of exactly the limit and rejects one character more, with a safe message', () => {
      const { service } = harness({ AI_SIM_MAX_INPUT_CHARS: '10' });
      expect(() => service.assertInputSize(T1, 'x'.repeat(10))).not.toThrow();
      const err = (() => { try { service.assertInputSize(T1, 'x'.repeat(11)); } catch (e) { return e as BadRequestException; } })();
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err!.getResponse()).toMatchObject({ code: 'SIMULATION_INPUT_TOO_LONG', limit: 10 });
      expect(JSON.stringify(err!.getResponse())).not.toContain('xxxxxxxxxx');
    });

    it('the default allows a normal test message and rejects an oversized one', () => {
      const { service } = harness();
      expect(() => service.assertInputSize(T1, 'x'.repeat(DEFAULT_SIMULATION_LIMITS.maxInputChars))).not.toThrow();
      expect(() => service.assertInputSize(T1, 'x'.repeat(DEFAULT_SIMULATION_LIMITS.maxInputChars + 1))).toThrow(BadRequestException);
    });

    it('a conversation with room accepts one more message; a full one asks for a new conversation', () => {
      const { service } = harness({ AI_SIM_MAX_CONVERSATION_TURNS: '3' });
      expect(() => service.assertConversationRoom(T1, 2)).not.toThrow();
      const err = (() => { try { service.assertConversationRoom(T1, 3); } catch (e) { return e as BadRequestException; } })();
      expect(err!.getResponse()).toMatchObject({ code: 'SIMULATION_CONVERSATION_TOO_LONG', limit: 3 });
    });

    it('per-tenant overrides apply to the input rules too', () => {
      const { service } = harness({ AI_SIM_TENANT_OVERRIDES: JSON.stringify({ [T2]: { maxInputChars: 5 } }) });
      expect(() => service.assertInputSize(T1, 'x'.repeat(100))).not.toThrow();
      expect(() => service.assertInputSize(T2, 'x'.repeat(6))).toThrow(BadRequestException);
    });
  });

  describe('a normal request', () => {
    it('runs the work once, returns its value and is not a replay, and counts against both allowances', async () => {
      const { service } = harness();
      const work = jest.fn().mockResolvedValue({ mode: 'SIMULATED' });
      const r = await service.execute(args(), work);
      expect(r).toEqual({ value: { mode: 'SIMULATED' }, replayed: false });
      expect(work).toHaveBeenCalledTimes(1);
      expect((await service.usage(T1, U1)).used).toMatchObject({ requestsToday: 1, userRequestsThisMinute: 1 });
    });

    it('a failing request still spends its unit (it reached the provider) and rethrows the original error', async () => {
      const { service } = harness();
      const boom = new Error('provider down');
      expect(await caught(service.execute(args(), async () => { throw boom; }))).toBe(boom);
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(1);
    });
  });

  describe('exhausted allowances', () => {
    it('refuses the request after the tenant daily budget, WITHOUT running the work, saying how long until it resets', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '3', AI_SIM_USER_PER_MINUTE: '60' }, '2026-10-29T23:00:00.000Z');
      const work = jest.fn().mockResolvedValue('ok');
      for (let i = 0; i < 3; i++) await service.execute(args({ userId: `user-${i}` }), work);
      const err = (await caught(service.execute(args({ userId: 'user-9' }), work))) as SimulationLimitReachedException;
      expect(err).toBeInstanceOf(SimulationLimitReachedException);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_LIMIT_REACHED', scope: 'tenant_daily', limit: 3, used: 3, retryAfterSeconds: 3600 });
      expect((err.getResponse() as { message: string }).message).toMatch(/3 test AI requests.*00:00 UTC/);
      expect(work).toHaveBeenCalledTimes(3);
    });

    it('refuses a user going too fast, with the seconds to the next minute, and allows them again then', async () => {
      const { service, clock } = harness({ AI_SIM_USER_PER_MINUTE: '2', AI_SIM_DAILY_REQUESTS: '100' }, '2026-10-29T10:00:30.000Z');
      const work = jest.fn().mockResolvedValue('ok');
      await service.execute(args(), work);
      await service.execute(args(), work);
      const err = (await caught(service.execute(args(), work))) as SimulationLimitReachedException;
      expect(err.getResponse()).toMatchObject({ scope: 'user_rate', limit: 2, used: 2, retryAfterSeconds: 30 });
      clock.advance(31_000);
      await expect(service.execute(args(), work)).resolves.toMatchObject({ replayed: false });
      expect(work).toHaveBeenCalledTimes(3);
    });

    it('the daily allowance resets at 00:00 UTC', async () => {
      const { service, clock } = harness({ AI_SIM_DAILY_REQUESTS: '1' }, '2026-10-29T23:59:00.000Z');
      await service.execute(args(), async () => 'a');
      expect(await caught(service.execute(args({ userId: 'u2' }), async () => 'b'))).toBeInstanceOf(SimulationLimitReachedException);
      clock.advance(2 * 60_000);
      await expect(service.execute(args({ userId: 'u3' }), async () => 'c')).resolves.toMatchObject({ value: 'c' });
    });

    it('a limit of 0 switches the tool off for that tenant only', async () => {
      const { service } = harness({ AI_SIM_TENANT_OVERRIDES: JSON.stringify({ [T2]: { dailyRequests: 0 } }) });
      const work = jest.fn().mockResolvedValue('ok');
      expect(await caught(service.execute(args({ tenantId: T2 }), work))).toBeInstanceOf(SimulationLimitReachedException);
      await expect(service.execute(args({ tenantId: T1 }), work)).resolves.toBeDefined();
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('a refusal consumes nothing: a blocked tenant budget does not eat the user\'s per-minute unit', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '1', AI_SIM_USER_PER_MINUTE: '5' });
      await service.execute(args(), async () => 'a');
      await caught(service.execute(args(), async () => 'b'));
      await caught(service.execute(args(), async () => 'c'));
      const u = await service.usage(T1, U1);
      expect(u.used).toMatchObject({ requestsToday: 1, userRequestsThisMinute: 1 });
    });
  });

  describe('tenant isolation', () => {
    it('one tenant exhausting its budget does not affect another, and counters and usage are per tenant', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '2', AI_SIM_USER_PER_MINUTE: '60' });
      await service.execute(args({ tenantId: T1 }), async () => 1);
      await service.execute(args({ tenantId: T1 }), async () => 2);
      expect(await caught(service.execute(args({ tenantId: T1 }), async () => 3))).toBeInstanceOf(SimulationLimitReachedException);
      await expect(service.execute(args({ tenantId: T2 }), async () => 4)).resolves.toMatchObject({ replayed: false });
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(2);
      expect((await service.usage(T2, U1)).used.requestsToday).toBe(1);
    });

    it('the same user id and request id in two tenants are separate', async () => {
      const { service } = harness();
      const work = jest.fn().mockResolvedValue('v');
      await service.execute(args({ tenantId: T1, requestId: 'same-request-1' }), work);
      const r = await service.execute(args({ tenantId: T2, requestId: 'same-request-1' }), work);
      expect(r.replayed).toBe(false);
      expect(work).toHaveBeenCalledTimes(2);
    });

    it('per-user windows are per user', async () => {
      const { service } = harness({ AI_SIM_USER_PER_MINUTE: '1', AI_SIM_DAILY_REQUESTS: '100' });
      await service.execute(args({ userId: 'a-user' }), async () => 1);
      await expect(service.execute(args({ userId: 'b-user' }), async () => 2)).resolves.toBeDefined();
      expect(await caught(service.execute(args({ userId: 'a-user' }), async () => 3))).toBeInstanceOf(SimulationLimitReachedException);
    });

    it.each([['tenant', { tenantId: 'a:b' }], ['tenant', { tenantId: 'a b' }], ['tenant', { tenantId: '' }], ['user', { userId: '../x' }], ['user', { userId: 'u*' }]])(
      'refuses an unsafe %s id so it can never shape a storage key', async (_l, over) => {
        const { service } = harness();
        const work = jest.fn();
        expect(await caught(service.execute(args(over), work))).toBeInstanceOf(BadRequestException);
        expect(work).not.toHaveBeenCalled();
      });
  });

  describe('concurrency', () => {
    it('50 simultaneous requests against a budget of 10 run exactly 10, and the rest are refused', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '10', AI_SIM_USER_PER_MINUTE: '60' });
      let ran = 0;
      const results = await Promise.all(Array.from({ length: 50 }, (_v, i) => service.execute(args({ userId: `user-${i % 7}` }), async () => { ran++; await new Promise((r) => setImmediate(r)); return i; }).then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : 'error'))));
      expect(ran).toBe(10);
      expect(results.filter((r) => r === 'ok')).toHaveLength(10);
      expect(results.filter((r) => r === 'refused')).toHaveLength(40);
      expect(results).not.toContain('error');
      expect((await service.usage(T1, 'user-0')).used.requestsToday).toBe(10);
    });

    it('simultaneous requests from one user never exceed the per-minute limit', async () => {
      const { service } = harness({ AI_SIM_USER_PER_MINUTE: '3', AI_SIM_DAILY_REQUESTS: '100' });
      let ran = 0;
      await Promise.all(Array.from({ length: 20 }, () => service.execute(args(), async () => { ran++; }).catch(() => undefined)));
      expect(ran).toBe(3);
    });

    it('simultaneous duplicates of one request id run the work once', async () => {
      const { service } = harness();
      let ran = 0;
      const out = await Promise.all(Array.from({ length: 10 }, () => service.execute(args({ requestId: 'dup-request-1' }), async () => { ran++; await new Promise((r) => setImmediate(r)); return 'v'; }).then((r) => (r.replayed ? 'replay' : 'ran'), (e) => (e instanceof ConflictException ? 'in-progress' : 'error'))));
      expect(ran).toBe(1);
      expect(out.filter((x) => x === 'ran')).toHaveLength(1);
      expect(out).not.toContain('error');
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(1);
    });
  });

  describe('retries and idempotency', () => {
    it('a retry of a processed request returns the stored result, runs nothing, and spends nothing', async () => {
      const { service } = harness();
      const work = jest.fn().mockResolvedValue({ mode: 'SIMULATED', message: { id: 'm1' } });
      const first = await service.execute(args({ requestId: 'request-aaa1' }), work);
      const second = await service.execute(args({ requestId: 'request-aaa1' }), work);
      expect(first.replayed).toBe(false);
      expect(second).toEqual({ value: { mode: 'SIMULATED', message: { id: 'm1' } }, replayed: true });
      expect(work).toHaveBeenCalledTimes(1);
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(1);
    });

    it('a replay works even when the allowances are exhausted (it spends nothing)', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '1' });
      await service.execute(args({ requestId: 'request-bbb1' }), async () => 'v');
      expect(await caught(service.execute(args({ requestId: 'request-bbb2' }), async () => 'w'))).toBeInstanceOf(SimulationLimitReachedException);
      await expect(service.execute(args({ requestId: 'request-bbb1' }), async () => 'x')).resolves.toEqual({ value: 'v', replayed: true });
    });

    it('a request still being processed is refused with 409, and the work is not started twice', async () => {
      const { service } = harness();
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const work = jest.fn().mockImplementation(async () => { await gate; return 'v'; });
      const first = service.execute(args({ requestId: 'request-ccc1' }), work);
      await new Promise((r) => setImmediate(r));
      const err = (await caught(service.execute(args({ requestId: 'request-ccc1' }), work))) as ConflictException;
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_REQUEST_IN_PROGRESS' });
      release();
      await first;
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('after a FAILED attempt, a retry with the same id is not re-run (no repeat cost) and is told to send a new message', async () => {
      const { service } = harness();
      const work = jest.fn().mockRejectedValue(new Error('provider timed out'));
      await caught(service.execute(args({ requestId: 'request-ddd1' }), work));
      const err = (await caught(service.execute(args({ requestId: 'request-ddd1' }), work))) as ConflictException;
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_REQUEST_ALREADY_PROCESSED' });
      expect(work).toHaveBeenCalledTimes(1);
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(1);
    });

    it('a NEW id after a failure is a new request and spends a new unit (bounded by the allowance)', async () => {
      const { service } = harness();
      await caught(service.execute(args({ requestId: 'request-eee1' }), async () => { throw new Error('x'); }));
      await expect(service.execute(args({ requestId: 'request-eee2' }), async () => 'v')).resolves.toMatchObject({ replayed: false });
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(2);
    });

    it('a request refused by a limit releases its id, so the same id works once the limit clears', async () => {
      const { service, clock } = harness({ AI_SIM_USER_PER_MINUTE: '1', AI_SIM_DAILY_REQUESTS: '100' });
      await service.execute(args({ requestId: 'request-fff1' }), async () => 'a');
      expect(await caught(service.execute(args({ requestId: 'request-fff2' }), async () => 'b'))).toBeInstanceOf(SimulationLimitReachedException);
      clock.advance(60_000);
      await expect(service.execute(args({ requestId: 'request-fff2' }), async () => 'b')).resolves.toMatchObject({ value: 'b', replayed: false });
    });

    it('the id is forgotten after its time to live', async () => {
      const { service, clock } = harness({ AI_SIM_IDEMPOTENCY_TTL_SECONDS: '60', AI_SIM_USER_PER_MINUTE: '60' });
      const work = jest.fn().mockResolvedValue('v');
      await service.execute(args({ requestId: 'request-ggg1' }), work);
      clock.advance(61_000);
      expect((await service.execute(args({ requestId: 'request-ggg1' }), work)).replayed).toBe(false);
      expect(work).toHaveBeenCalledTimes(2);
    });

    it.each(['short', 'has space in it', 'a'.repeat(65), 'bad/chars/here!', ''])('rejects a malformed request id (%s)', async (requestId) => {
      const { service } = harness();
      const work = jest.fn();
      expect(await caught(service.execute(args({ requestId }), work))).toBeInstanceOf(BadRequestException);
      expect(work).not.toHaveBeenCalled();
    });

    it('a result too large to store is replaced by a marker: the retry is refused, not re-run', async () => {
      const { service } = harness();
      const work = jest.fn().mockResolvedValue({ big: 'x'.repeat(200_000) });
      await service.execute(args({ requestId: 'request-hhh1' }), work);
      expect(await caught(service.execute(args({ requestId: 'request-hhh1' }), work))).toBeInstanceOf(ConflictException);
      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  describe('precheck', () => {
    it('a failing precheck spends nothing, never runs the work, and releases the request id', async () => {
      const { service } = harness();
      const work = jest.fn();
      const err = new BadRequestException('conversation full');
      expect(await caught(service.execute(args({ requestId: 'request-iii1', precheck: () => { throw err; } }), work))).toBe(err);
      expect(work).not.toHaveBeenCalled();
      expect((await service.usage(T1, U1)).used.requestsToday).toBe(0);
      await expect(service.execute(args({ requestId: 'request-iii1' }), async () => 'v')).resolves.toMatchObject({ replayed: false });
    });

    it('is skipped on a replay, so replaying the request that filled the conversation still returns its result', async () => {
      const { service } = harness();
      const precheck = jest.fn();
      await service.execute(args({ requestId: 'request-jjj1', precheck }), async () => 'v');
      expect(precheck).toHaveBeenCalledTimes(1);
      const r = await service.execute(args({ requestId: 'request-jjj1', precheck: () => { throw new BadRequestException('full'); } }), async () => 'w');
      expect(r).toEqual({ value: 'v', replayed: true });
    });

    it('runs before any allowance is taken', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '0' });
      const precheck = jest.fn();
      await caught(service.execute(args({ precheck }), async () => 'v'));
      expect(precheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the counters are unavailable the request is REFUSED (never an uncapped call)', () => {
    const broken = (over: Partial<Record<keyof SimulationStore, () => Promise<never>>>): SimulationStore => {
      const fail = () => Promise.reject(new Error('redis down'));
      return { reserve: fail, read: fail, claim: fail, get: fail, set: fail, del: fail, ...over } as SimulationStore;
    };
    const svc = (store: SimulationStore) => new SimulationLimitsService({ get: () => undefined } as never, store);

    it('a failing reserve refuses with 503 and runs nothing', async () => {
      const work = jest.fn();
      const err = await caught(svc(broken({})).execute(args(), work));
      expect(err).toBeInstanceOf(SimulationUnavailableException);
      expect((err as SimulationUnavailableException).getStatus()).toBe(503);
      expect(work).not.toHaveBeenCalled();
    });

    it('a failing request-id claim refuses with 503 and runs nothing', async () => {
      const work = jest.fn();
      expect(await caught(svc(broken({})).execute(args({ requestId: 'request-kkk1' }), work))).toBeInstanceOf(SimulationUnavailableException);
      expect(work).not.toHaveBeenCalled();
    });

    it('losing the write that stores the result does not turn a finished request into a failure', async () => {
      const mem = new MemorySimulationStore();
      const store: SimulationStore = { reserve: (s: CounterSpec[]) => mem.reserve(s), read: (k) => mem.read(k), claim: (k, v, t) => mem.claim(k, v, t), get: (k) => mem.get(k), set: () => Promise.reject(new Error('redis down')), del: (k) => mem.del(k) };
      await expect(svc(store).execute(args({ requestId: 'request-lll1' }), async () => 'v')).resolves.toEqual({ value: 'v', replayed: false });
    });

    it('usage reporting fails with 503, not with zeros', async () => {
      expect(await caught(svc(broken({})).usage(T1, U1))).toBeInstanceOf(SimulationUnavailableException);
    });

    it('the unavailable response says nothing about the cause', async () => {
      const err = (await caught(svc(broken({})).execute(args(), jest.fn()))) as SimulationUnavailableException;
      expect(JSON.stringify(err.getResponse())).not.toMatch(/redis/i);
    });
  });

  describe('simulated AI Learning evaluations', () => {
    it('allows the daily budget and then declines, per tenant', async () => {
      const { service } = harness({ AI_SIM_DAILY_EVALUATIONS: '2' });
      expect(await service.reserveEvaluation(T1)).toBe(true);
      expect(await service.reserveEvaluation(T1)).toBe(true);
      expect(await service.reserveEvaluation(T1)).toBe(false);
      expect(await service.reserveEvaluation(T2)).toBe(true);
    });

    it('a budget of 0 grades nothing', async () => {
      expect(await harness({ AI_SIM_DAILY_EVALUATIONS: '0' }).service.reserveEvaluation(T1)).toBe(false);
    });

    it('declines (does not grade) when the counters are unavailable', async () => {
      const store = { reserve: () => Promise.reject(new Error('down')) } as unknown as SimulationStore;
      expect(await new SimulationLimitsService({ get: () => undefined } as never, store).reserveEvaluation(T1)).toBe(false);
    });

    it('50 concurrent attempts against a budget of 5 grade exactly 5', async () => {
      const { service } = harness({ AI_SIM_DAILY_EVALUATIONS: '5' });
      const r = await Promise.all(Array.from({ length: 50 }, () => service.reserveEvaluation(T1)));
      expect(r.filter(Boolean)).toHaveLength(5);
    });
  });

  describe('evaluation runs', () => {
    it('allows the daily number of runs and then refuses with 429', async () => {
      const { service } = harness({ AI_SIM_DAILY_EVAL_RUNS: '2' });
      await service.reserveEvalRun(T1);
      await service.reserveEvalRun(T1);
      const err = (await caught(service.reserveEvalRun(T1))) as SimulationLimitReachedException;
      expect(err.getResponse()).toMatchObject({ scope: 'eval_runs_daily', limit: 2, used: 2 });
      await expect(service.reserveEvalRun(T2)).resolves.toBeUndefined();
    });

    it('refuses with 503 when the counters are unavailable', async () => {
      const store = { reserve: () => Promise.reject(new Error('down')) } as unknown as SimulationStore;
      expect(await caught(new SimulationLimitsService({ get: () => undefined } as never, store).reserveEvalRun(T1))).toBeInstanceOf(SimulationUnavailableException);
    });
  });

  describe('usage report', () => {
    it('reports the limits in force, what has been used, and when the daily allowance resets', async () => {
      const { service } = harness({ AI_SIM_DAILY_REQUESTS: '50' }, '2026-10-29T18:00:00.000Z');
      await service.execute(args(), async () => 1);
      await service.reserveEvaluation(T1);
      const u = await service.usage(T1, U1);
      expect(u.limits.dailyRequests).toBe(50);
      expect(u.used).toEqual({ requestsToday: 1, userRequestsThisMinute: 1, evaluationsToday: 1, evalRunsToday: 0 });
      expect(u.resetsAt).toBe('2026-10-30T00:00:00.000Z');
    });

    it('reports a tenant\'s own override and nothing of another tenant', async () => {
      const { service } = harness({ AI_SIM_TENANT_OVERRIDES: JSON.stringify({ [T2]: { dailyRequests: 7 } }) });
      expect((await service.usage(T2, U1)).limits.dailyRequests).toBe(7);
      expect((await service.usage(T1, U1)).limits.dailyRequests).toBe(DEFAULT_SIMULATION_LIMITS.dailyRequests);
      expect(JSON.stringify(await service.usage(T1, U1))).not.toContain(T2);
    });
  });
});
