import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { QueueName } from '@whatsapp-platform/shared-types';

const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000; // every 15 min -- payment issues are more time-sensitive than analytics rollups
const LOOKBACK_DAYS = 3;

/**
 * Managed Commerce reconciliation -- compares recently PAID orders against
 * Paystack's own live transaction-verify API and flags any mismatch as a
 * ReconciliationException for manual review. Read-only: never mutates the
 * ledger itself (that stays exclusively CommerceLedgerService's job, driven
 * by the webhook path) -- this is a safety net that catches drift, not
 * another way to record revenue.
 *
 * No cross-app import of backend services (matches this worker's existing
 * pattern -- see analytics-rollup.processor.ts's comment on dayBoundaries):
 * calls Paystack directly with its own axios request rather than reusing
 * apps/backend's PaystackGateway class, and writes ReconciliationException
 * rows via raw Prisma rather than importing ReconciliationService.
 */
export class CommerceReconciliationWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue(QueueName.COMMERCE_RECONCILIATION, { connection: this.connection });

    await this.queue.add(
      'reconcile',
      {},
      {
        repeat: { every: RECONCILIATION_INTERVAL_MS },
        jobId: 'commerce-reconciliation-repeatable',
        removeOnComplete: 5,
        removeOnFail: 5,
      },
    );

    this.worker = new Worker<Record<string, never>>(
      QueueName.COMMERCE_RECONCILIATION,
      this.process.bind(this),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[CommerceReconciliation] Job failed:', err.message);
    });

    console.log('[CommerceReconciliation] Worker started -- reconciling every 15 min');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process() {
    const secretKey = process.env['PAYSTACK_SECRET_KEY'];
    if (!secretKey) {
      console.warn('[CommerceReconciliation] PAYSTACK_SECRET_KEY not set -- skipping this run');
      return;
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: since },
        paystackReference: { not: null },
        // Synthetic fixture orders created by the AI evaluation harness carry a fake
        // Paystack reference with no real transaction -- verifying them against
        // Paystack's live API would always fail and raise a false exception.
        isEvalOrder: false,
        reconciliationExceptions: { none: { status: 'OPEN' } },
      },
      select: { id: true, tenantId: true, totalMajorUnits: true, currency: true, paystackReference: true },
    });

    for (const order of orders) {
      try {
        await this.reconcileOrder(order, secretKey);
      } catch (err) {
        console.error(`[CommerceReconciliation] Failed to reconcile order ${order.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async reconcileOrder(
    order: { id: string; tenantId: string; totalMajorUnits: number; currency: string; paystackReference: string | null },
    secretKey: string,
  ) {
    const res = await axios
      .get(`https://api.paystack.co/transaction/verify/${order.paystackReference}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
        timeout: 10_000,
      })
      .catch((err) => {
        // A verify call failing (network/4xx/5xx) is itself worth flagging --
        // it means we can no longer confirm this payment is real from Paystack's side.
        return { data: null, error: err instanceof Error ? err.message : String(err) } as { data: null; error: string };
      });

    if (!res.data) {
      await this.createException(order, 'VERIFY_CALL_FAILED', { error: (res as { error: string }).error });
      return;
    }

    const tx = res.data.data as { status: string; amount: number; currency: string } | undefined;
    if (!tx) {
      await this.createException(order, 'MISSING_SETTLEMENT', { paystackResponse: res.data });
      return;
    }

    const actualAmount = tx.amount / 100;
    const expectedAmount = order.totalMajorUnits;
    const amountMismatch = Math.abs(actualAmount - expectedAmount) > 0.01;
    const statusMismatch = tx.status !== 'success';

    if (amountMismatch || statusMismatch) {
      await this.createException(order, amountMismatch ? 'AMOUNT_MISMATCH' : 'STATUS_MISMATCH', {
        expectedAmountMajorUnits: expectedAmount,
        actualAmountMajorUnits: actualAmount,
        paystackStatus: tx.status,
      });
    }
  }

  private async createException(
    order: { id: string; tenantId: string },
    type: string,
    details: { expectedAmountMajorUnits?: number; actualAmountMajorUnits?: number; [key: string]: unknown },
  ) {
    const existing = await this.prisma.reconciliationException.findFirst({
      where: { tenantId: order.tenantId, orderId: order.id, type, status: 'OPEN' },
    });
    if (existing) return;

    await this.prisma.reconciliationException.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        type,
        expectedAmountMajorUnits: details.expectedAmountMajorUnits,
        actualAmountMajorUnits: details.actualAmountMajorUnits,
        details: details as never,
      },
    });
    console.log(`[CommerceReconciliation] Flagged order ${order.id}: ${type}`);
  }
}
