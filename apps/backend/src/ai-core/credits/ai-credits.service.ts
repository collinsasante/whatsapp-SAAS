import { Injectable, Logger } from '@nestjs/common';
import { AiCreditTransaction, AiCreditTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SettleResult {
  /** False only when the tenant's balance was already too low at the moment
   * of settlement (a real edge case: usage came in between the pre-call
   * gate and settlement) -- the call still happened and was still delivered,
   * but the tenant is not driven negative. Logged for observability. */
  settled: boolean;
  transaction: AiCreditTransaction | null;
}

/**
 * The single owner of Tenant.aiCredits mutations. From this point on, the
 * balance may only ever change together with an AiCreditTransaction insert,
 * in the same DB transaction -- see the model's own doc comment in
 * schema.prisma. Idempotency (one settlement per AI call, one grant per
 * purchase) is enforced by real @unique constraints on aiExecutionId/
 * creditPurchaseId, the same pattern CommerceLedgerEntry already uses for
 * payment webhooks -- a P2002 on insert means a concurrent/duplicate call
 * already settled this, so the whole transaction rolls back safely and the
 * winning row is returned instead.
 */
@Injectable()
export class AiCreditsService {
  private readonly logger = new Logger(AiCreditsService.name);

  constructor(private prisma: PrismaService) {}

  async getBalance(tenantId: string): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } });
    return tenant?.aiCredits ?? 0;
  }

  /** Coarse pre-call gate, not a reservation -- deliberately just "is the
   * balance non-empty," matching the exact semantics AiResponderService's
   * shouldRespond()/isAiUsable() already used before this service existed.
   * The precise charge happens at settleForExecution() once real usage is
   * known; see the plan's reasoning for not building a full reserve-and-hold
   * system. */
  async hasSufficientBalance(tenantId: string): Promise<boolean> {
    return (await this.getBalance(tenantId)) > 0;
  }

  /** Called once per completed AI call, right after its AiExecution row is
   * written. `credits` is 0 for a non-SUCCESS trace (failed/blocked calls
   * are never charged) -- still worth calling so the linkage/idempotency
   * bookkeeping is consistent, though a 0-credit settlement writes no
   * balance change (still writes a $0 ledger row for a complete audit
   * trail, per "make it possible to investigate why a tenant lost N
   * credits"). */
  async settleForExecution(tenantId: string, aiExecutionId: string, credits: number, description: string): Promise<SettleResult> {
    if (credits < 0) throw new Error('settleForExecution credits must be >= 0');

    const existing = await this.prisma.aiCreditTransaction.findUnique({ where: { aiExecutionId } });
    if (existing) return { settled: true, transaction: existing };

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (credits === 0) {
          const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } });
          const transaction = await tx.aiCreditTransaction.create({
            data: { tenantId, type: AiCreditTransactionType.AI_USAGE, credits: 0, balanceAfter: tenant?.aiCredits ?? 0, aiExecutionId, description },
          });
          return { settled: true, transaction };
        }

        const decremented = await tx.tenant.updateMany({ where: { id: tenantId, aiCredits: { gte: credits } }, data: { aiCredits: { decrement: credits } } });
        if (decremented.count === 0) {
          this.logger.warn(`Tenant ${tenantId} had insufficient balance to settle ${credits} credits for AiExecution ${aiExecutionId} -- reply already delivered, balance not driven negative`);
          return { settled: false, transaction: null };
        }

        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } });
        const transaction = await tx.aiCreditTransaction.create({
          data: { tenantId, type: AiCreditTransactionType.AI_USAGE, credits: -credits, balanceAfter: tenant?.aiCredits ?? 0, aiExecutionId, description },
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
    if (credits <= 0) throw new Error('chargeFlat credits must be > 0');

    const decremented = await this.prisma.tenant.updateMany({ where: { id: tenantId, aiCredits: { gte: credits } }, data: { aiCredits: { decrement: credits } } });
    if (decremented.count === 0) return { settled: false, transaction: null };

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } });
    const transaction = await this.prisma.aiCreditTransaction.create({
      data: {
        tenantId,
        type: AiCreditTransactionType.AI_USAGE,
        credits: -credits,
        balanceAfter: tenant?.aiCredits ?? 0,
        description,
        metadata: { estimated: true, reason: 'legacy path, no token tracking' },
      },
    });
    return { settled: true, transaction };
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
        await tx.tenant.update({ where: { id: tenantId }, data: { aiCredits: { increment: credits } } });
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { aiCredits: true } });
        const transaction = await tx.aiCreditTransaction.create({
          data: { tenantId, type, credits, balanceAfter: tenant?.aiCredits ?? 0, creditPurchaseId: opts.creditPurchaseId, description, metadata: opts.metadata },
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
}
