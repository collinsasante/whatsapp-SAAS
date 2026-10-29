import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParsedSimulationConfig, parseSimulationConfig, resolveSimulationLimits, SimulationLimits } from './simulation-limits.config';
import { SimulationStore } from './simulation-store';

export const SIMULATION_STORE = Symbol('SIMULATION_STORE');
export const SIMULATION_CLOCK = Symbol('SIMULATION_CLOCK');

export type SimulationKind = 'test-chat' | 'commerce-test-chat' | 'ai-sandbox';
export type LimitScope = 'user_rate' | 'tenant_daily' | 'eval_runs_daily';

/** 429. Says which limit was hit and when it clears. Contains only this tenant's own numbers; never a secret. */
export class SimulationLimitReachedException extends HttpException {
  constructor(readonly scope: LimitScope, readonly limit: number, readonly used: number, readonly retryAfterSeconds: number) {
    super({
      statusCode: 429,
      code: 'SIMULATION_LIMIT_REACHED',
      scope,
      limit,
      used,
      retryAfterSeconds,
      message: SimulationLimitReachedException.describe(scope, limit, retryAfterSeconds),
    }, 429);
  }

  private static describe(scope: LimitScope, limit: number, retryAfterSeconds: number): string {
    if (scope === 'user_rate') return `You are sending test messages too quickly. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`;
    if (scope === 'eval_runs_daily') return `This workspace has used its ${limit} evaluation run${limit === 1 ? '' : 's'} for today. The allowance resets at 00:00 UTC.`;
    return `This workspace has used its ${limit} test AI request${limit === 1 ? '' : 's'} for today. The allowance resets at 00:00 UTC.`;
  }
}

/** 503. The counters could not be reached, so the request is REFUSED: it never falls back to an uncapped call. */
export class SimulationUnavailableException extends HttpException {
  constructor() {
    super({ statusCode: 503, code: 'SIMULATION_LIMITS_UNAVAILABLE', message: 'The test tools are temporarily unavailable. Nothing was sent. Please try again shortly.' }, 503);
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** The idempotency record keeps the full stored response; anything larger is replaced by a marker. */
const MAX_STORED_RESULT_CHARS = 100_000;
const DAY_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
const MINUTE_COUNTER_TTL_SECONDS = 120;

type IdempotencyRecord =
  | { state: 'pending' }
  | { state: 'done'; value: unknown }
  | { state: 'done-without-result' }
  | { state: 'failed' };

export interface SimulationUsage {
  limits: SimulationLimits;
  used: { requestsToday: number; userRequestsThisMinute: number; evaluationsToday: number; evalRunsToday: number };
  /** Next 00:00 UTC, when the daily allowances reset. */
  resetsAt: string;
}

@Injectable()
export class SimulationLimitsService {
  private readonly logger = new Logger(SimulationLimitsService.name);
  private readonly config: ParsedSimulationConfig;

  constructor(
    config: ConfigService,
    @Inject(SIMULATION_STORE) private readonly store: SimulationStore,
    @Optional() @Inject(SIMULATION_CLOCK) private readonly clock?: () => Date,
  ) {
    this.config = parseSimulationConfig((key) => config.get<string>(key));
    for (const warning of this.config.warnings) this.logger.warn(`Simulation limits: ${warning}`);
  }

  private now(): Date { return this.clock ? this.clock() : new Date(); }

  limitsFor(tenantId: string): SimulationLimits {
    return resolveSimulationLimits(this.config, tenantId);
  }

  // ---------------------------------------------------------------------------------------------------- keys

  private safe(id: string, what: string): string {
    if (!SAFE_ID.test(id)) throw new BadRequestException(`Invalid ${what}.`);
    return id;
  }
  private static stamp(d: Date): string { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
  private dayKey(tenantId: string, name: string, d: Date): string { return `verz:aisim:v1:t:${this.safe(tenantId, 'tenant')}:d:${SimulationLimitsService.stamp(d)}:${name}`; }
  private minuteKey(tenantId: string, userId: string, d: Date): string { return `verz:aisim:v1:u:${this.safe(tenantId, 'tenant')}:${this.safe(userId, 'user')}:m:${Math.floor(d.getTime() / 60_000)}`; }
  private idemKey(tenantId: string, userId: string, requestId: string): string { return `verz:aisim:v1:i:${this.safe(tenantId, 'tenant')}:${this.safe(userId, 'user')}:${requestId}`; }

  private static secondsUntilNextUtcMidnight(d: Date): number {
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
  }

  /** Any failure reaching the counters is a refusal, never a pass. */
  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Simulation limit store failed; refusing the request: ${err instanceof Error ? err.message : String(err)}`);
      throw new SimulationUnavailableException();
    }
  }

  // ------------------------------------------------------------------------------------------------- input rules

  /** A test message longer than the tenant's limit is rejected before anything is spent. */
  assertInputSize(tenantId: string, text: string): void {
    const max = this.limitsFor(tenantId).maxInputChars;
    if (text.length > max) {
      throw new BadRequestException({ statusCode: 400, code: 'SIMULATION_INPUT_TOO_LONG', limit: max, message: `Test messages are limited to ${max} characters (this one has ${text.length}). Shorten it and try again.` });
    }
  }

  /** `turnsSoFar` customer messages already in the conversation; a further one must fit. */
  assertConversationRoom(tenantId: string, turnsSoFar: number): void {
    const max = this.limitsFor(tenantId).maxConversationTurns;
    if (turnsSoFar >= max) {
      throw new BadRequestException({ statusCode: 400, code: 'SIMULATION_CONVERSATION_TOO_LONG', limit: max, message: `This test conversation has reached ${max} messages. Start a new conversation to keep testing.` });
    }
  }

  // --------------------------------------------------------------------------------------- the guarded request

  /**
   * Runs one simulated AI request under every limit, at most once per request id.
   *
   *  1. With a request id, a repeat of a request that already ran returns the stored result (`replayed: true`) and spends nothing:
   *     no quota, no provider call. One still running is refused (409), and one that failed is not silently re-run.
   *  2. The per-user rate and the per-tenant daily budget are taken in ONE atomic, all-or-nothing step, so concurrent requests can
   *     never take more than the limit between them, and a refusal consumes nothing.
   *  3. `work` runs only after both are held. If the counters are unreachable the request is refused.
   *
   * The unit is spent on attempt, not on success: a request that reached the provider and failed has still cost something, so a
   * failure is not refunded. Cheap validation (input size, conversation length, feature enabled) belongs BEFORE this call.
   */
  async execute<T>(
    args: {
      tenantId: string; userId: string; kind: SimulationKind; requestId?: string;
      /**
       * State-dependent validation (for example "is this conversation full"). Runs AFTER a replay has been recognised, so replaying the
       * request that filled the conversation still returns its stored result, and BEFORE any quota is taken, so a rejected request
       * spends nothing and releases its request id.
       */
      precheck?: () => void | Promise<void>;
    },
    work: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const { tenantId, userId, requestId } = args;
    const limits = this.limitsFor(tenantId);
    const now = this.now();

    let idemKey: string | undefined;
    if (requestId !== undefined) {
      if (!REQUEST_ID.test(requestId)) throw new BadRequestException('Invalid request id.');
      idemKey = this.idemKey(tenantId, userId, requestId);
      const replay = await this.beginIdempotent(idemKey, limits.idempotencyTtlSeconds);
      if (replay) return { value: replay.value as T, replayed: true };
    }

    try {
      if (args.precheck) await args.precheck();
      const reserved = await this.guarded(() => this.store.reserve([
        { key: this.minuteKey(tenantId, userId, now), limit: limits.userPerMinute, ttlSeconds: MINUTE_COUNTER_TTL_SECONDS },
        { key: this.dayKey(tenantId, 'requests', now), limit: limits.dailyRequests, ttlSeconds: DAY_COUNTER_TTL_SECONDS },
      ]));
      if (!reserved.ok) {
        if (reserved.blockedIndex === 0) {
          // The per-user window is the calendar minute, so it clears at the next minute boundary.
          throw new SimulationLimitReachedException('user_rate', limits.userPerMinute, reserved.count, 60 - (Math.floor(now.getTime() / 1000) % 60));
        }
        throw new SimulationLimitReachedException('tenant_daily', limits.dailyRequests, reserved.count, SimulationLimitsService.secondsUntilNextUtcMidnight(now));
      }
    } catch (err) {
      // Nothing ran, so the request id is released: the caller may retry once the limit clears.
      if (idemKey) await this.release(idemKey);
      throw err;
    }

    let value: T;
    try {
      value = await work();
    } catch (err) {
      // The attempt was paid for. Remember that it failed, so a retry with the same id does not run it (and pay) again.
      if (idemKey) await this.remember(idemKey, { state: 'failed' }, limits.idempotencyTtlSeconds);
      throw err;
    }
    if (idemKey) await this.remember(idemKey, this.resultRecord(value), limits.idempotencyTtlSeconds);
    return { value, replayed: false };
  }

  private resultRecord(value: unknown): IdempotencyRecord {
    try {
      const text = JSON.stringify(value);
      return text !== undefined && text.length <= MAX_STORED_RESULT_CHARS ? { state: 'done', value } : { state: 'done-without-result' };
    } catch {
      return { state: 'done-without-result' };
    }
  }

  private async beginIdempotent(key: string, ttlSeconds: number): Promise<{ value: unknown } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await this.guarded(() => this.store.claim(key, JSON.stringify({ state: 'pending' } satisfies IdempotencyRecord), ttlSeconds))) return null;
      const raw = await this.guarded(() => this.store.get(key));
      if (raw === null) continue; // expired between the two calls: claim again
      let record: IdempotencyRecord;
      try { record = JSON.parse(raw) as IdempotencyRecord; } catch { record = { state: 'failed' }; }
      if (record.state === 'done') return { value: record.value };
      if (record.state === 'pending') {
        throw new ConflictException({ statusCode: 409, code: 'SIMULATION_REQUEST_IN_PROGRESS', message: 'This request is already being processed. Wait for it to finish.' });
      }
      throw new ConflictException({ statusCode: 409, code: 'SIMULATION_REQUEST_ALREADY_PROCESSED', message: 'This request was already processed and did not complete. Send your message again as a new message.' });
    }
    throw new SimulationUnavailableException();
  }

  /** Best effort: the work already happened, so losing this write must not turn a success into a failure. */
  private async remember(key: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void> {
    try { await this.store.set(key, JSON.stringify(record), ttlSeconds); }
    catch (err) { this.logger.warn(`Could not store the outcome of a simulated request: ${err instanceof Error ? err.message : String(err)}`); }
  }

  private async release(key: string): Promise<void> {
    try { await this.store.del(key); } catch { /* the key expires on its own */ }
  }

  // ------------------------------------------------------------------------------- other simulated cost centres

  /**
   * One unit of the tenant's daily budget for the paid AI Learning judge grading a SIMULATED reply. Returns false (do not grade) when
   * the budget is spent or the counters are unreachable; the reply itself is unaffected.
   */
  async reserveEvaluation(tenantId: string): Promise<boolean> {
    const limit = this.limitsFor(tenantId).dailyEvaluations;
    try {
      const r = await this.store.reserve([{ key: this.dayKey(tenantId, 'evaluations', this.now()), limit, ttlSeconds: DAY_COUNTER_TTL_SECONDS }]);
      return r.ok;
    } catch (err) {
      this.logger.error(`Could not check the simulated-evaluation budget; the evaluation is skipped: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** One commerce evaluation run (~15-20 scripted conversations) from the tenant's daily run budget. */
  async reserveEvalRun(tenantId: string): Promise<void> {
    const now = this.now();
    const limit = this.limitsFor(tenantId).dailyEvalRuns;
    const r = await this.guarded(() => this.store.reserve([{ key: this.dayKey(tenantId, 'evalruns', now), limit, ttlSeconds: DAY_COUNTER_TTL_SECONDS }]));
    if (!r.ok) throw new SimulationLimitReachedException('eval_runs_daily', limit, r.count, SimulationLimitsService.secondsUntilNextUtcMidnight(now));
  }

  // ------------------------------------------------------------------------------------------------ reporting

  async usage(tenantId: string, userId: string): Promise<SimulationUsage> {
    const now = this.now();
    const [requestsToday, userRequestsThisMinute, evaluationsToday, evalRunsToday] = await this.guarded(() => this.store.read([
      this.dayKey(tenantId, 'requests', now), this.minuteKey(tenantId, userId, now), this.dayKey(tenantId, 'evaluations', now), this.dayKey(tenantId, 'evalruns', now),
    ]));
    return {
      limits: this.limitsFor(tenantId),
      used: { requestsToday, userRequestsThisMinute, evaluationsToday, evalRunsToday },
      resetsAt: new Date(now.getTime() + SimulationLimitsService.secondsUntilNextUtcMidnight(now) * 1000).toISOString(),
    };
  }
}
