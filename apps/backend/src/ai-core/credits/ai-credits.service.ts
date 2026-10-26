import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AiCreditReservation, AiCreditReservationStatus, AiCreditTransaction, AiCreditTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiPricingService } from '../pricing/ai-pricing.service';

const RESERVATION_TTL_MS = 15 * 60_000;
const RESERVATION_SWEEP_INTERVAL_MS = 60_000;

export class InsufficientAiCreditsError extends Error {
  constructor() {
    super('Insufficient AI credits for the maximum provider-call reservation.');
    this.name = 'InsufficientAiCreditsError';
  }
}

export interface SettleResult {
  /** False when neither the unreserved balance nor this reservation can cover
   * the settlement; provider output may already have been delivered. */
  settled: boolean;
  transaction: AiCreditTransaction | null;
}

/**
 * The single owner of Tenant.aiCredits mutations. From this point on, the
 * balance may only ever change together with an AiCreditTransaction insert,
 * in the same DB transaction -- see the model's own doc comment in
 * schema.prisma. Idempotency (one settlement per AI call, one grant per
 * purchase) is enforced by real @unique constraints on aiExecutionId,
 * creditPurchaseId, and reservationId -- a P2002 means a concurrent or
 * duplicate operation already settled this, so the winning row is returned.
 */
@Injectable()
export class AiCreditsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiCreditsService.name);
  private reservationSweepTimer: NodeJS.Timeout | undefined;

  constructor(private prisma: PrismaService, private pricing: AiPricingService) {}

  async getBalance(tenantId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await this.lockTenant(tx, tenantId);
      const held = await this.getHeldCredits(tx, tenantId);
      return Math.max(0, tenant.aiCredits - held);
    });
  }

  /** Coarse pre-call gate. The provider-call reservation remains authoritative. */
  async hasSufficientBalance(tenantId: string): Promise<boolean> {
    return (await this.getBalance(tenantId)) > 0;
  }

  onModuleInit(): void {
    this.reservationSweepTimer = setInterval(() => {
      void this.expireUnresolvedReservations().catch((error: unknown) => {
        this.logger.error('Failed to expire unresolved AI credit reservations', error instanceof Error ? error.stack : String(error));
      });
    }, RESERVATION_SWEEP_INTERVAL_MS);
    this.reservationSweepTimer.unref?.();
    void this.expireUnresolvedReservations().catch((error: unknown) => {
      this.logger.error('Failed to expire unresolved AI credit reservations', error instanceof Error ? error.stack : String(error));
    });
  }

  onModuleDestroy(): void {
    if (this.reservationSweepTimer) clearInterval(this.reservationSweepTimer);
  }

  async reserveForProviderCall(
    tenantId: string,
    provider: string,
    modelKey: string,
    maxTokens: number | undefined,
    maxAttempts: number,
  ): Promise<AiCreditReservation> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('AI provider maxAttempts must be a positive integer');
    const quote = await this.pricing.getReservationQuote(provider, modelKey, maxTokens, maxAttempts);
    if (!Number.isSafeInteger(quote.reservedCredits) || quote.reservedCredits < 0
      || !Number.isSafeInteger(quote.maxCreditsPerAttempt) || quote.maxCreditsPerAttempt < 0) {
      throw new Error(`Invalid AI reservation quote for ${provider}:${modelKey}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const tenant = await this.lockTenant(tx, tenantId);
      const heldCredits = await this.getHeldCredits(tx, tenantId);
      if (tenant.aiCredits - heldCredits < quote.reservedCredits) throw new InsufficientAiCreditsError();

      return tx.aiCreditReservation.create({
        data: {
          tenantId,
          idempotencyKey: randomUUID(),
          reservedCredits: quote.reservedCredits,
          maxCreditsPerAttempt: quote.maxCreditsPerAttempt,
          pricingCreditsPerUsd: quote.creditsPerUsd,
          pricingInputCostPerMillionUsd: quote.inputPerMTokUsd,
          pricingOutputCostPerMillionUsd: quote.outputPerMTokUsd,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });
    });
  }

  async reserveFixedCredits(tenantId: string, credits: number): Promise<AiCreditReservation> {
    if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error('Fixed AI credit reservation must be a positive safe integer');

    return this.prisma.$transaction(async (tx) => {
      const tenant = await this.lockTenant(tx, tenantId);
      const heldCredits = await this.getHeldCredits(tx, tenantId);
      if (tenant.aiCredits - heldCredits < credits) throw new InsufficientAiCreditsError();

      return tx.aiCreditReservation.create({
        data: {
          tenantId,
          idempotencyKey: randomUUID(),
          reservedCredits: credits,
          maxCreditsPerAttempt: credits,
          pricingCreditsPerUsd: 0,
          pricingInputCostPerMillionUsd: 0,
          pricingOutputCostPerMillionUsd: 0,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });
    });
  }

  async settleReservation(
    reservationId: string,
    credits: number,
    description: string,
    metadata: Prisma.InputJsonObject = {},
  ): Promise<SettleResult> {
    if (!Number.isInteger(credits) || credits < 0) throw new Error('settleReservation credits must be a non-negative integer');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const initialReservation = await tx.aiCreditReservation.findUnique({ where: { id: reservationId } });
        if (!initialReservation) throw new Error(`AI credit reservation ${reservationId} was not found`);
        const tenant = await this.lockTenant(tx, initialReservation.tenantId);
        const [reservation, existing] = await Promise.all([
          tx.aiCreditReservation.findUnique({ where: { id: reservationId } }),
          tx.aiCreditTransaction.findUnique({ where: { reservationId } }),
        ]);
        if (existing) return { settled: true, transaction: existing };
        if (!reservation || reservation.status !== AiCreditReservationStatus.RESERVED) return { settled: false, transaction: null };
        const heldCredits = await this.getHeldCredits(tx, reservation.tenantId);
        const otherHeldCredits = heldCredits - reservation.reservedCredits;
        if (credits > tenant.aiCredits - otherHeldCredits) {
          throw new Error(`Actual AI usage exceeded available credits for reservation ${reservationId}`);
        }

        const updatedTenant = await tx.tenant.update({
          where: { id: reservation.tenantId },
          data: { aiCredits: { decrement: credits } },
          select: { aiCredits: true },
        });
        const transaction = await tx.aiCreditTransaction.create({
          data: {
            tenantId: reservation.tenantId,
            type: AiCreditTransactionType.AI_USAGE,
            credits: -credits,
            balanceAfter: updatedTenant.aiCredits,
            reservationId,
            description,
            metadata: { reservedCredits: reservation.reservedCredits, ...metadata },
          },
        });
        await tx.aiCreditReservation.update({
          where: { id: reservationId },
          data: { status: AiCreditReservationStatus.SETTLED, settledCredits: credits },
        });
        return { settled: true, transaction };
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        const winner = await this.prisma.aiCreditTransaction.findUnique({ where: { reservationId } });
        return { settled: true, transaction: winner };
      }
      throw err;
    }
  }

  async settleReservationForUsage(
    reservationId: string,
    inputTokens: number,
    outputTokens: number,
    attemptsUsed: number,
    description: string,
  ): Promise<SettleResult> {
    if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
      throw new Error('AI provider token usage must be non-negative integers');
    }
    if (!Number.isInteger(attemptsUsed) || attemptsUsed < 1) throw new Error('AI provider attemptsUsed must be a positive integer');

    const reservation = await this.prisma.aiCreditReservation.findUnique({ where: { id: reservationId } });
    if (!reservation) throw new Error(`AI credit reservation ${reservationId} was not found`);
    if (reservation.maxCreditsPerAttempt > 0 && attemptsUsed > reservation.reservedCredits / reservation.maxCreditsPerAttempt) {
      throw new Error(`AI provider attempts exceeded reserved maximum for reservation ${reservationId}`);
    }

    const actualCredits = this.pricing.calculateCreditsForUsage({
      creditsPerUsd: reservation.pricingCreditsPerUsd,
      inputPerMTokUsd: reservation.pricingInputCostPerMillionUsd,
      outputPerMTokUsd: reservation.pricingOutputCostPerMillionUsd,
    }, inputTokens, outputTokens);
    const failedAttemptCredits = reservation.maxCreditsPerAttempt * (attemptsUsed - 1);
    return this.settleReservation(reservationId, failedAttemptCredits + actualCredits, description);
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.aiCreditReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.status !== AiCreditReservationStatus.RESERVED) return;
      await this.lockTenant(tx, reservation.tenantId);
      await tx.aiCreditReservation.updateMany({
        where: { id: reservationId, status: AiCreditReservationStatus.RESERVED },
        data: { status: AiCreditReservationStatus.RELEASED },
      });
    });
  }

  private async expireUnresolvedReservations(): Promise<void> {
    const expired = await this.prisma.aiCreditReservation.findMany({
      where: { status: AiCreditReservationStatus.RESERVED, expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 100,
    });

    for (const { id } of expired) {
      await this.prisma.$transaction(async (tx) => {
        const initialReservation = await tx.aiCreditReservation.findUnique({ where: { id } });
        if (!initialReservation) return;
        const tenant = await this.lockTenant(tx, initialReservation.tenantId);
        const reservation = await tx.aiCreditReservation.findUnique({ where: { id } });
        if (!reservation || reservation.status !== AiCreditReservationStatus.RESERVED || reservation.expiresAt > new Date()) return;
        const transitioned = await tx.aiCreditReservation.updateMany({
          where: { id, status: AiCreditReservationStatus.RESERVED, expiresAt: { lte: new Date() } },
          data: { status: AiCreditReservationStatus.EXPIRED, settledCredits: reservation.reservedCredits },
        });
        if (transitioned.count === 0) return;

        const balance = await tx.tenant.update({
          where: { id: tenant.id },
          data: { aiCredits: { decrement: reservation.reservedCredits } },
          select: { aiCredits: true },
        });
        await tx.aiCreditTransaction.create({
          data: {
            tenantId: reservation.tenantId,
            type: AiCreditTransactionType.AI_USAGE,
            credits: -reservation.reservedCredits,
            balanceAfter: balance.aiCredits,
            reservationId: reservation.id,
            description: 'AI provider call outcome unknown; expired reservation charged at reserved maximum',
            metadata: { expiredReservation: true, reservedCredits: reservation.reservedCredits },
          },
        });
      });
    }
  }

  async linkReservationsToExecution(tenantId: string, executionId: string, reservationIds: string[]): Promise<void> {
    if (reservationIds.length === 0) return;
    await this.prisma.aiCreditReservation.updateMany({
      where: { id: { in: [...new Set(reservationIds)] }, tenantId, aiExecutionId: null },
      data: { aiExecutionId: executionId },
    });
  }

  /** Called once per completed AI call, right after its AiExecution row is
   * written. `credits` is 0 for a non-SUCCESS trace (failed/blocked calls
   * are never charged) -- still worth calling so the linkage/idempotency
   * bookkeeping is consistent, though a 0-credit settlement writes no
   * balance change (still writes a $0 ledger row for a complete audit
   * trail, per "make it possible to investigate why a tenant lost N
   * credits"). */
  async settleForExecution(tenantId: string, aiExecutionId: string, credits: number, description: string): Promise<SettleResult> {
    if (!Number.isInteger(credits) || credits < 0) throw new Error('settleForExecution credits must be a non-negative integer');

    const existing = await this.prisma.aiCreditTransaction.findUnique({ where: { aiExecutionId } });
    if (existing) return { settled: true, transaction: existing };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await this.lockTenant(tx, tenantId);
        const heldCredits = await this.getHeldCredits(tx, tenantId);
        if (credits === 0) {
          const transaction = await tx.aiCreditTransaction.create({
            data: { tenantId, type: AiCreditTransactionType.AI_USAGE, credits: 0, balanceAfter: tenant.aiCredits, aiExecutionId, description },
          });
          return { settled: true, transaction };
        }

        if (tenant.aiCredits - heldCredits < credits) {
          this.logger.warn(`Tenant ${tenantId} had insufficient balance to settle ${credits} credits for AiExecution ${aiExecutionId} -- reply already delivered, balance not driven negative`);
          return { settled: false, transaction: null };
        }

        const updatedTenant = await tx.tenant.update({ where: { id: tenantId }, data: { aiCredits: { decrement: credits } }, select: { aiCredits: true } });
        const transaction = await tx.aiCreditTransaction.create({
          data: { tenantId, type: AiCreditTransactionType.AI_USAGE, credits: -credits, balanceAfter: updatedTenant.aiCredits, aiExecutionId, description },
        });
        return { settled: true, transaction };
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        const winner = await this.prisma.aiCreditTransaction.findUnique({ where: { aiExecutionId } });
        return { settled: true, transaction: winner };
      }
      throw err;
    }
  }

  /** For the legacy AI responder path (no per-call token tracking) -- a
   * fixed, honestly-labeled estimate rather than real metering. No
   * aiExecutionId to key idempotency off since that path never creates an
   * AiExecution row; matches the flat-charge cadence the old code already
   * had for this specific path. */
  async chargeFlat(tenantId: string, credits: number, description: string): Promise<SettleResult> {
    if (!Number.isInteger(credits) || credits <= 0) throw new Error('chargeFlat credits must be a positive integer');

    // One transaction, like settleForExecution: a failed ledger insert must not leave the credits already deducted.
    return this.prisma.$transaction(async (tx) => {
      const tenant = await this.lockTenant(tx, tenantId);
      const heldCredits = await this.getHeldCredits(tx, tenantId);
      if (tenant.aiCredits - heldCredits < credits) return { settled: false, transaction: null };

      const updatedTenant = await tx.tenant.update({ where: { id: tenantId }, data: { aiCredits: { decrement: credits } }, select: { aiCredits: true } });
      const transaction = await tx.aiCreditTransaction.create({
        data: {
          tenantId,
          type: AiCreditTransactionType.AI_USAGE,
          credits: -credits,
          balanceAfter: updatedTenant.aiCredits,
          description,
          metadata: { estimated: true, reason: 'legacy path, no token tracking' },
        },
      });
      return { settled: true, transaction };
    });
  }

  /** Purchases, bonuses, and admin adjustments -- anything that grants or
   * removes credits outside of AI usage. `creditPurchaseId` (when set) is
   * the idempotency key: a duplicate webhook delivery for the same purchase
   * can never grant twice. */
  async grant(
    tenantId: string,
    type: Exclude<AiCreditTransactionType, 'AI_USAGE'>,
    credits: number,
    description: string,
    opts: { creditPurchaseId?: string; metadata?: Prisma.InputJsonValue } = {},
  ): Promise<SettleResult> {
    if (opts.creditPurchaseId) {
      const existing = await this.prisma.aiCreditTransaction.findUnique({ where: { creditPurchaseId: opts.creditPurchaseId } });
      if (existing) return { settled: true, transaction: existing };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await this.lockTenant(tx, tenantId);
        if (credits < 0) {
          const heldCredits = await this.getHeldCredits(tx, tenantId);
          if (tenant.aiCredits - heldCredits < -credits) return { settled: false, transaction: null };
        }
        const updatedTenant = await tx.tenant.update({ where: { id: tenantId }, data: { aiCredits: { increment: credits } }, select: { aiCredits: true } });
        const transaction = await tx.aiCreditTransaction.create({
          data: { tenantId, type, credits, balanceAfter: updatedTenant.aiCredits, creditPurchaseId: opts.creditPurchaseId, description, metadata: opts.metadata },
        });
        return { settled: true, transaction };
      });
    } catch (err) {
      if (opts.creditPurchaseId && this.isUniqueConstraintError(err)) {
        const winner = await this.prisma.aiCreditTransaction.findUnique({ where: { creditPurchaseId: opts.creditPurchaseId } });
        return { settled: true, transaction: winner };
      }
      throw err;
    }
  }

  async getTransactions(tenantId: string, opts: { page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 20, 100);
    const [items, total] = await Promise.all([
      this.prisma.aiCreditTransaction.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.aiCreditTransaction.count({ where: { tenantId } }),
    ]);
    return { items, total, page, limit };
  }

  /** Admin-scoped counterpart to getTransactions() -- tenantId is an optional filter here, not a requirement, unlike the tenant-facing endpoint. */
  async adminListTransactions(opts: { tenantId?: string; type?: AiCreditTransactionType; limit?: number; offset?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const offset = opts.offset ?? 0;
    const where = {
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      ...(opts.type ? { type: opts.type } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.aiCreditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.aiCreditTransaction.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getUsageSummary(tenantId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [balance, thisMonth, lifetime] = await Promise.all([
      this.getBalance(tenantId),
      this.prisma.aiCreditTransaction.groupBy({ by: ['type'], where: { tenantId, createdAt: { gte: monthStart } }, _sum: { credits: true }, _count: true }),
      this.prisma.aiCreditTransaction.groupBy({ by: ['type'], where: { tenantId }, _sum: { credits: true } }),
    ]);

    const sumFor = (rows: { type: AiCreditTransactionType; _sum: { credits: number | null } }[], type: AiCreditTransactionType) =>
      Math.abs(rows.find((r) => r.type === type)?._sum.credits ?? 0);
    const aiRequestsThisMonth = thisMonth.find((r) => r.type === AiCreditTransactionType.AI_USAGE)?._count ?? 0;

    return {
      currentBalance: balance,
      usedThisMonth: sumFor(thisMonth, AiCreditTransactionType.AI_USAGE),
      purchasedThisMonth: sumFor(thisMonth, AiCreditTransactionType.PURCHASE),
      aiRequestsThisMonth,
      totalPurchased: sumFor(lifetime, AiCreditTransactionType.PURCHASE),
      totalUsed: sumFor(lifetime, AiCreditTransactionType.AI_USAGE),
    };
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<{ id: string; aiCredits: number }> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, aiCredits: true } });
    if (!tenant) throw new Error(`Tenant ${tenantId} was not found while reserving AI credits`);
    return tenant;
  }

  private async getHeldCredits(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const result = await tx.aiCreditReservation.aggregate({
      where: { tenantId, status: AiCreditReservationStatus.RESERVED },
      _sum: { reservedCredits: true },
    });
    return result._sum.reservedCredits ?? 0;
  }
}
