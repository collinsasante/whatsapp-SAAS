import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LEARNING_COST_CONFIG, LEARNING_COST_CONFIG, LearningCostConfig } from './learning-cost.config';
import { LEARNING_LEASE_MS, LEARNING_MAX_OUTPUT_TOKENS, LEARNING_MAX_RUNS_PER_EXECUTION } from './learning-queue.constants';
import { LEARNING_PRICE_TABLE, costMicros } from './pricing/learning-price-table';

export type LearningSkipReason = 'not_enabled' | 'paused' | 'run_cap' | 'workspace_cap' | 'global_cap' | 'run_ceiling' | 'already_settled' | 'in_flight';

export type ReserveResult =
  | { kind: 'reserved'; usageId: string; runNo: number; leaseExpiresAt: Date; reservedMicros: bigint }
  /** `retryLater` is true only when another live run holds the reservation: the queue should try again after its lease. */
  | { kind: 'skipped'; reason: LearningSkipReason; retryLater: boolean };

export type FailureCharge =
  /** The provider rejected the request before doing work (auth, validation): nothing was billed. */
  | { kind: 'not_billed' }
  /** The outcome is unknown (timeout, network, 5xx): the provider may have billed, so the full reservation stays counted. */
  | { kind: 'uncertain' }
  /** The provider reported usage even though the run failed afterwards. */
  | { kind: 'billed'; inputTokens: number; outputTokens: number };

export interface UsageSummary {
  workspaceMicros: bigint;
  globalMicros: bigint;
  workspaceCapMicros: bigint;
  globalCapMicros: bigint;
}

/** Serialises every reservation on the platform. One lock keeps both the workspace cap and the global cap exact; see reserve(). */
const RESERVATION_LOCK_KEY = 'ai_learning_cost_ledger';
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/** What a ledger row currently counts against the caps. Expired and failed-with-unknown-outcome rows keep their maximum estimate. */
const COUNTED_MICROS_SQL = Prisma.sql`CASE state::text
  WHEN 'RESERVED' THEN reserved_micros
  WHEN 'EXPIRED' THEN reserved_micros
  WHEN 'COMPLETED' THEN COALESCE(actual_micros, reserved_micros)
  WHEN 'FAILED' THEN COALESCE(actual_micros, reserved_micros)
  WHEN 'FENCED' THEN COALESCE(actual_micros, reserved_micros)
  ELSE 0 END`;
/** Database clock, as a UTC timestamp without zone (the representation Prisma uses for these columns). */
const DB_NOW_UTC = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
const MONTH_START_UTC = Prisma.sql`date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')`;

/**
 * The platform-funded cost ledger for AI Learning provider calls. It is separate from, and never touches, the customer AI credit
 * system (AiCreditTransaction / AiCreditReservation / AiMeteredProviderService).
 *
 * Safety argument
 *  - A paid call may only start after reserve() returned 'reserved'. reserve() runs in ONE transaction that first takes a
 *    transaction-scoped advisory lock shared by every reservation, so concurrent reservations are totally ordered: each sees every
 *    earlier one's committed rows, checks the workspace and global caps against them, and inserts its own. Two runs can therefore
 *    never both pass a cap that only one of them fits under.
 *  - Each run is a new row with the next run number. Retries, stall recoveries and manual re-queues all come back through
 *    reserve(), so each is separately accounted, and the per-execution ceiling is enforced here, in the database, not just in the queue.
 *  - Row-state fencing. Only one RESERVED row per execution can exist (partial unique index). A takeover first moves the lapsed row to
 *    EXPIRED, then inserts the next run. A finisher settles with `UPDATE ... WHERE id = ? AND state = 'RESERVED'`; if a takeover got
 *    there first the update matches nothing and the result is FENCED: it is recorded for cost accuracy but never applied. The row lock
 *    makes this atomic under READ COMMITTED (no subquery over other rows is involved).
 *  - Expiry does NOT release budget. EXPIRED rows keep their reserved maximum until reconciled with real usage (a late FENCED
 *    settlement, or reconcileExpired by an operator). Only an uncertain-outcome failure keeps its full reservation too.
 *  - Leases and "this month" use the database clock, not the application's.
 */
@Injectable()
export class AiLearningCostService {
  private readonly logger = new Logger(AiLearningCostService.name);
  private readonly config: LearningCostConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(LEARNING_COST_CONFIG) config?: LearningCostConfig,
  ) {
    this.config = config ?? DEFAULT_LEARNING_COST_CONFIG;
  }

  /** Reservation for a request of `estimatedInputTokens` (an upper estimate, see estimate-input-tokens.util.ts) and a capped answer. */
  reservationFor(estimatedInputTokens: number): bigint {
    return costMicros(estimatedInputTokens, LEARNING_MAX_OUTPUT_TOKENS);
  }

  async reserve(input: { tenantId: string; aiExecutionId: string; estimatedInputTokens: number }): Promise<ReserveResult> {
    const { tenantId, aiExecutionId, estimatedInputTokens } = input;
    const reservedMicros = this.reservationFor(estimatedInputTokens);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RESERVATION_LOCK_KEY}))`;

      const settings = await tx.aiLearningSettings.findUnique({ where: { tenantId } });
      if (!settings?.learningEnabled) return { kind: 'skipped', reason: 'not_enabled', retryLater: false } as const;
      if (settings.learningPaused) return { kind: 'skipped', reason: 'paused', retryLater: false } as const;

      // 1. A lapsed lease is expired first (atomic, row-locked). Only after this can the rows be read as "live or settled".
      await tx.$executeRaw`UPDATE ai_learning_usage SET state = 'EXPIRED'::"AiLearningUsageState"
        WHERE ai_execution_id = ${aiExecutionId} AND state = 'RESERVED'::"AiLearningUsageState" AND lease_expires_at <= ${DB_NOW_UTC}`;

      const runs = await tx.aiLearningUsage.findMany({ where: { aiExecutionId }, select: { runNo: true, state: true } });
      if (runs.some((r) => r.state === 'COMPLETED')) return { kind: 'skipped', reason: 'already_settled', retryLater: false } as const;
      if (runs.some((r) => r.state === 'RESERVED')) return { kind: 'skipped', reason: 'in_flight', retryLater: true } as const;
      // Paid runs only: a SKIPPED row made no call. FENCED/EXPIRED/FAILED all may have been billed.
      if (runs.filter((r) => r.state !== 'SKIPPED').length >= LEARNING_MAX_RUNS_PER_EXECUTION) {
        return { kind: 'skipped', reason: 'run_ceiling', retryLater: false } as const;
      }
      const runNo = runs.reduce((max, r) => Math.max(max, r.runNo), 0) + 1;

      // 2. Caps, against everything committed so far this month (the lock guarantees nothing newer can slip in).
      const deny = async (reason: 'run_cap' | 'workspace_cap' | 'global_cap'): Promise<ReserveResult> => {
        await tx.$executeRaw`INSERT INTO ai_learning_usage
          (id, tenant_id, ai_execution_id, run_no, state, reserved_micros, estimated_input_tokens, price_table_version, skip_reason, lease_expires_at, settled_at, created_at)
          VALUES (${randomUUID()}, ${tenantId}, ${aiExecutionId}, ${runNo}, 'SKIPPED'::"AiLearningUsageState", 0, ${estimatedInputTokens},
                  ${LEARNING_PRICE_TABLE.version}, ${reason}, ${DB_NOW_UTC}, ${DB_NOW_UTC}, ${DB_NOW_UTC})`;
        return { kind: 'skipped', reason, retryLater: false };
      };
      if (reservedMicros > this.config.maxReservationMicros) return deny('run_cap');

      const [sums] = await tx.$queryRaw<Array<{ tenant_micros: bigint; global_micros: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN tenant_id = ${tenantId} THEN counted END), 0)::bigint AS tenant_micros,
               COALESCE(SUM(counted), 0)::bigint AS global_micros
        FROM (SELECT tenant_id, ${COUNTED_MICROS_SQL} AS counted FROM ai_learning_usage WHERE created_at >= ${MONTH_START_UTC}) u`);
      const workspaceCap = settings.monthlyBudgetMicros ?? this.config.workspaceMonthlyBudgetMicros;
      if (sums!.tenant_micros + reservedMicros > workspaceCap) return deny('workspace_cap');
      if (sums!.global_micros + reservedMicros > this.config.globalMonthlyBudgetMicros) return deny('global_cap');

      // 3. Reserve. The partial unique index would reject this insert if a RESERVED row for the execution somehow existed.
      const [row] = await tx.$queryRaw<Array<{ id: string; lease_expires_at: Date }>>(Prisma.sql`
        INSERT INTO ai_learning_usage
          (id, tenant_id, ai_execution_id, run_no, state, reserved_micros, estimated_input_tokens, price_table_version, lease_expires_at, created_at)
        VALUES (${randomUUID()}, ${tenantId}, ${aiExecutionId}, ${runNo}, 'RESERVED'::"AiLearningUsageState", ${reservedMicros}, ${estimatedInputTokens},
                ${LEARNING_PRICE_TABLE.version}, ${DB_NOW_UTC} + (${LEARNING_LEASE_MS}::int * interval '1 millisecond'), ${DB_NOW_UTC})
        RETURNING id, lease_expires_at`);
      return { kind: 'reserved', usageId: row!.id, runNo, leaseExpiresAt: row!.lease_expires_at, reservedMicros } as const;
    }, TX_OPTIONS);
  }

  /**
   * Settles a successful call with the provider-reported usage. 'fenced' means a takeover expired this run first: do not apply its
   * result. `null` means the provider reported no usage: nothing is invented, the full reservation stays counted.
   */
  async settle(usageId: string, usage: { inputTokens: number; outputTokens: number } | null): Promise<'completed' | 'fenced'> {
    const actualMicros = usage ? costMicros(usage.inputTokens, usage.outputTokens) : null;
    if (usage && actualMicros !== null) await this.tripwire(usageId, usage, actualMicros);
    const data = { actualMicros, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, settledAt: new Date() };
    const done = await this.prisma.aiLearningUsage.updateMany({ where: { id: usageId, state: 'RESERVED' }, data: { ...data, state: 'COMPLETED' } });
    if (done.count > 0) return 'completed';
    await this.reconcileLate(usageId, data);
    return 'fenced';
  }

  /** Settles a run whose provider call failed. Never throws for an already-fenced run. */
  async fail(usageId: string, charge: FailureCharge): Promise<'failed' | 'fenced'> {
    const base = { settledAt: new Date() };
    const billed = charge.kind === 'billed' ? { inputTokens: charge.inputTokens, outputTokens: charge.outputTokens, actualMicros: costMicros(charge.inputTokens, charge.outputTokens) } : undefined;
    const data = charge.kind === 'not_billed' ? { ...base, actualMicros: 0n } : charge.kind === 'billed' ? { ...base, ...billed } : base; // uncertain: actual stays null -> the reservation stays counted
    const done = await this.prisma.aiLearningUsage.updateMany({ where: { id: usageId, state: 'RESERVED' }, data: { ...data, state: 'FAILED' } });
    if (done.count > 0) return 'failed';
    if (charge.kind !== 'uncertain') await this.reconcileLate(usageId, data);
    return 'fenced';
  }

  /**
   * Operator reconciliation of an EXPIRED reservation whose real cost is now known (for example from the provider's billing page).
   * Until this is called the row keeps counting its full reservation. Returns whether a row was reconciled.
   */
  async reconcileExpired(usageId: string, actualMicros: bigint): Promise<boolean> {
    if (actualMicros < 0n) throw new RangeError('actualMicros must not be negative');
    const done = await this.prisma.aiLearningUsage.updateMany({ where: { id: usageId, state: 'EXPIRED' }, data: { state: 'FAILED', actualMicros, settledAt: new Date() } });
    return done.count > 0;
  }

  async summary(tenantId: string): Promise<UsageSummary> {
    const [row] = await this.prisma.$queryRaw<Array<{ tenant_micros: bigint; global_micros: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN tenant_id = ${tenantId} THEN counted END), 0)::bigint AS tenant_micros,
             COALESCE(SUM(counted), 0)::bigint AS global_micros
      FROM (SELECT tenant_id, ${COUNTED_MICROS_SQL} AS counted FROM ai_learning_usage WHERE created_at >= ${MONTH_START_UTC}) u`);
    const settings = await this.prisma.aiLearningSettings.findUnique({ where: { tenantId }, select: { monthlyBudgetMicros: true } });
    return {
      workspaceMicros: row!.tenant_micros,
      globalMicros: row!.global_micros,
      workspaceCapMicros: settings?.monthlyBudgetMicros ?? this.config.workspaceMonthlyBudgetMicros,
      globalCapMicros: this.config.globalMonthlyBudgetMicros,
    };
  }

  /** A late result for a run a takeover already expired: record its real usage on that row (EXPIRED -> FENCED) so the reservation is reconciled. */
  private async reconcileLate(usageId: string, data: Prisma.AiLearningUsageUncheckedUpdateManyInput): Promise<void> {
    await this.prisma.aiLearningUsage.updateMany({ where: { id: usageId, state: 'EXPIRED' }, data: { ...data, state: 'FENCED' } });
  }

  /**
   * The estimate is meant to be an upper bound. If the provider ever bills or reports more than reserved, the estimate or the price
   * table is wrong: stop spending for this workspace and say so loudly (ids and numbers only, never content).
   */
  private async tripwire(usageId: string, usage: { inputTokens: number }, actualMicros: bigint): Promise<void> {
    const row = await this.prisma.aiLearningUsage.findUnique({ where: { id: usageId }, select: { tenantId: true, reservedMicros: true, estimatedInputTokens: true, aiExecutionId: true } });
    if (!row || (actualMicros <= row.reservedMicros && usage.inputTokens <= row.estimatedInputTokens)) return;
    this.logger.error(JSON.stringify({
      event: 'ai_learning.cost_tripwire', tenantId: row.tenantId, aiExecutionId: row.aiExecutionId, usageId,
      reservedMicros: row.reservedMicros.toString(), actualMicros: actualMicros.toString(),
      estimatedInputTokens: row.estimatedInputTokens, reportedInputTokens: usage.inputTokens, priceTableVersion: LEARNING_PRICE_TABLE.version,
    }));
    await this.prisma.aiLearningSettings.upsert({ where: { tenantId: row.tenantId }, create: { tenantId: row.tenantId, learningPaused: true }, update: { learningPaused: true } });
  }
}
