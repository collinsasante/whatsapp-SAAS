import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LedgerEntryType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackGateway } from '../../billing/gateways/paystack.gateway';
import { LeadsService } from '../../leads/leads.service';
import { isValidOrderTransition } from '../orders/order-state.util';
import { computeRefundAdjustment, computeTakeRate } from './take-rate.util';

const DEFAULT_COMMERCE_FEE_SETTING_KEY = 'default_commerce_fee_pct';
const DEFAULT_COMMERCE_FEE_CACHE_TTL_MS = 60_000;

@Injectable()
export class CommerceLedgerService {
  private readonly logger = new Logger(CommerceLedgerService.name);
  private defaultFeeCache: { value: number; cachedAt: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private paystack: PaystackGateway,
    // Injected via LeadsModule's @Global() export, not a CommerceModule import edge --
    // see leads.module.ts for why.
    private leads: LeadsService,
  ) {}

  /** Verz AI Credits / commerce fee: platform-admin-configurable global default,
   * applied only when a tenant has never had TenantSettings.takeRatePct explicitly
   * set -- an explicit per-tenant rate (via setCommerceConfig) always wins. Small
   * TTL cache, same pattern as FeatureFlagsService.isEnabledCached. */
  private async getDefaultCommerceFeePct(): Promise<number> {
    if (this.defaultFeeCache && Date.now() - this.defaultFeeCache.cachedAt < DEFAULT_COMMERCE_FEE_CACHE_TTL_MS) {
      return this.defaultFeeCache.value;
    }
    const row = await this.prisma.platformSettings.findUnique({ where: { key: DEFAULT_COMMERCE_FEE_SETTING_KEY } }).catch(() => null);
    const value = typeof row?.value === 'number' ? row.value : 0;
    this.defaultFeeCache = { value, cachedAt: Date.now() };
    return value;
  }

  /**
   * Pull-based counterpart to the Paystack webhook: asks Paystack's verify API
   * whether the order's transaction actually succeeded, and only then promotes
   * it through recordPaymentSuccess -- the same trusted path the webhook uses.
   * The client's claim is never trusted; Paystack's API response is the only
   * input. Useful when webhook delivery is unavailable (e.g. staging without a
   * public HTTPS endpoint) or a merchant needs to re-check a "customer says
   * they paid" order.
   */
  async verifyAndRecordPayment(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.PAID) {
      return { verified: true, alreadyPaid: true, order };
    }
    if (!order.paystackReference) {
      throw new BadRequestException('Order has no payment reference to verify -- it was never submitted for payment');
    }

    const tx = await this.paystack.verifyTransaction(order.paystackReference).catch((err) => {
      this.logger.warn(`verifyAndRecordPayment: Paystack verify failed for ${order.paystackReference}: ${String(err)}`);
      return null;
    });
    if (!tx) {
      return { verified: false, reason: 'Paystack has no record of this transaction yet', order };
    }
    if (tx.status !== 'success') {
      return { verified: false, reason: `Paystack reports status "${tx.status}"`, paystackStatus: tx.status, order };
    }
    if (Math.abs(tx.amountMajorUnits - order.totalMajorUnits) > 0.01) {
      return {
        verified: false,
        reason: `Amount mismatch: Paystack says ${tx.amountMajorUnits}, order total is ${order.totalMajorUnits}`,
        order,
      };
    }

    const updated = await this.recordPaymentSuccess(order.id, tx.transactionId, tx.amountMajorUnits);
    return { verified: true, alreadyPaid: false, order: updated ?? order };
  }

  /**
   * The ONLY path in the codebase that can set Order.status = PAID. Called
   * exclusively from CommerceWebhookController once a payment has been
   * independently verified by the gateway (never from AI tool-calling,
   * never from a generic admin/order-update endpoint).
   *
   * Idempotent by DB constraint, not just an app-level check: the
   * `@@unique([orderId, type, gatewayEventId])` on CommerceLedgerEntry means
   * a duplicate webhook delivery for the same event hits a unique-violation
   * inside the transaction and is caught below as a no-op, rather than
   * relying purely on a check-then-write race like BillingEvent's pattern.
   */
  async recordPaymentSuccess(orderId: string, gatewayEventId: string, verifiedAmountMajorUnits: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      this.logger.warn(`recordPaymentSuccess: unknown order ${orderId}`);
      return null;
    }

    if (order.status === OrderStatus.PAID) {
      // Already processed (most likely a duplicate webhook delivery) -- verify the
      // amount matches what we already recorded and no-op rather than re-processing.
      const existing = await this.prisma.commerceLedgerEntry.findFirst({
        where: { orderId, type: LedgerEntryType.GMV, gatewayEventId },
      });
      if (existing) {
        this.logger.log(`Duplicate payment webhook for order ${orderId} / event ${gatewayEventId} skipped`);
        return existing;
      }
      // Order is PAID but this specific event wasn't the one that paid it -- a second,
      // different successful payment event for an already-paid order should not happen;
      // log loudly rather than silently double-counting revenue.
      this.logger.error(`Order ${orderId} already PAID but received a new payment event ${gatewayEventId} -- ignoring, does not affect the ledger`);
      return null;
    }

    if (!isValidOrderTransition(order.status, OrderStatus.PAID)) {
      this.logger.error(`Cannot mark order ${orderId} PAID from status ${order.status}`);
      return null;
    }

    const tenantSettings = await this.prisma.tenantSettings.findUnique({ where: { tenantId: order.tenantId } });
    const takeRatePct = tenantSettings?.takeRatePct ?? (await this.getDefaultCommerceFeePct());
    const gmvAmount = verifiedAmountMajorUnits;
    const takeRateAmount = computeTakeRate(gmvAmount, takeRatePct);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PAID, paidAt: new Date() },
        });

        const gmvEntry = await tx.commerceLedgerEntry.create({
          data: {
            tenantId: order.tenantId,
            orderId,
            type: LedgerEntryType.GMV,
            amountMajorUnits: gmvAmount,
            currency: order.currency,
            gatewayEventId,
            data: { verifiedAmountMajorUnits },
            processed: true,
          },
        });

        await tx.commerceLedgerEntry.create({
          data: {
            tenantId: order.tenantId,
            orderId,
            type: LedgerEntryType.TAKE_RATE,
            // Negative: this is platform revenue taken OUT of the merchant's proceeds,
            // not additional money changing hands -- see ledger.controller.ts summary math.
            amountMajorUnits: -takeRateAmount,
            currency: order.currency,
            gatewayEventId,
            data: { takeRatePct, gmvAmount },
            processed: true,
          },
        });

        await tx.orderEvent.create({
          data: { tenantId: order.tenantId, orderId, type: 'PAID', data: { gatewayEventId, gmvAmount, takeRateAmount } },
        });

        return { updatedOrder, gmvEntry };
      });

      this.logger.log(`Order ${orderId} PAID -- GMV ${gmvAmount} ${order.currency}, take-rate ${takeRateAmount} (${takeRatePct}%)`);

      // Best-effort: a real payment is the one deterministic, non-AI signal that a lead
      // converted (see leads.service.ts's VALID_STATUSES comment -- the model itself can
      // never set this status). Not every order has a conversationId (e.g. an order
      // placed outside a WhatsApp conversation), so this is a no-op in that case.
      if (order.conversationId) {
        this.leads.markConverted(order.tenantId, order.conversationId)
          .catch((err) => this.logger.warn(`Failed to mark lead converted for order ${orderId}: ${String(err)}`));
      }

      return result.gmvEntry;
    } catch (err) {
      // Unique constraint violation on (orderId, type, gatewayEventId) means a
      // concurrent duplicate delivery of this exact webhook lost the race safely.
      if (this.isUniqueConstraintError(err)) {
        this.logger.log(`Concurrent duplicate payment webhook for order ${orderId} / event ${gatewayEventId} -- safely no-op'd`);
        return this.prisma.commerceLedgerEntry.findFirst({ where: { orderId, type: LedgerEntryType.GMV, gatewayEventId } });
      }
      throw err;
    }
  }

  /**
   * Records a (possibly partial) refund as a REFUND_ADJUSTMENT entry -- never
   * mutates or deletes the original GMV/TAKE_RATE entries. Only moves the
   * order to REFUNDED once the cumulative refunded amount reaches the full
   * order total; a partial refund keeps the order's current status.
   */
  async recordRefund(orderId: string, refundAmountMajorUnits: number, gatewayEventId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.FULFILLING && order.status !== OrderStatus.COMPLETED) {
      throw new ConflictException(`Cannot refund an order in status ${order.status}`);
    }

    const priorAdjustments = await this.prisma.commerceLedgerEntry.findMany({
      where: { orderId, type: LedgerEntryType.REFUND_ADJUSTMENT },
    });
    const alreadyRefundedMajorUnits = Math.round(priorAdjustments.reduce((sum, e) => sum + Math.abs((e.data as { refundAmountMajorUnits?: number })?.refundAmountMajorUnits ?? 0), 0) * 100) / 100;

    // Pre-existing limitation, not introduced here: this re-reads the tenant's
    // CURRENT rate (or default) rather than whatever rate was actually applied at
    // payment time. If a rate changes between payment and refund, the clawback
    // uses the new rate, not the original one. Out of scope for this change.
    const tenantSettings = await this.prisma.tenantSettings.findUnique({ where: { tenantId: order.tenantId } });
    const takeRatePct = tenantSettings?.takeRatePct ?? (await this.getDefaultCommerceFeePct());

    const { takeRateClawbackMajorUnits } = computeRefundAdjustment({
      orderTotalMajorUnits: order.totalMajorUnits,
      takeRatePct,
      alreadyRefundedMajorUnits,
      refundAmountMajorUnits,
    });

    const isFullRefund = Math.round((alreadyRefundedMajorUnits + refundAmountMajorUnits) * 100) / 100 >= order.totalMajorUnits;

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.commerceLedgerEntry.create({
        data: {
          tenantId: order.tenantId,
          orderId,
          type: LedgerEntryType.REFUND_ADJUSTMENT,
          amountMajorUnits: -takeRateClawbackMajorUnits,
          currency: order.currency,
          gatewayEventId,
          data: { refundAmountMajorUnits, takeRateClawbackMajorUnits },
          processed: true,
        },
      });

      if (isFullRefund) {
        await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.REFUNDED } });
        await tx.orderEvent.create({ data: { tenantId: order.tenantId, orderId, type: 'REFUNDED', data: { refundAmountMajorUnits } } });
      }

      return entry;
    });
  }

  async getLedger(tenantId: string, opts: { page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const [entries, total, summary] = await Promise.all([
      this.prisma.commerceLedgerEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.commerceLedgerEntry.count({ where: { tenantId } }),
      this.prisma.commerceLedgerEntry.groupBy({ by: ['type'], where: { tenantId }, _sum: { amountMajorUnits: true } }),
    ]);
    return {
      entries,
      total,
      page,
      limit,
      totals: Object.fromEntries(summary.map((s) => [s.type, s._sum.amountMajorUnits ?? 0])),
    };
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002';
  }
}
