import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceLedgerService } from '../ledger/commerce-ledger.service';

/** Customer-facing checkout state -- deliberately coarser than the internal
 * OrderStatus state machine (spec: never expose internal mechanics). */
export type CheckoutState = 'AWAITING_PAYMENT' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED' | 'REVIEW_PENDING';

function toCheckoutState(status: OrderStatus): CheckoutState {
  switch (status) {
    case OrderStatus.PENDING_PAYMENT:
      return 'AWAITING_PAYMENT';
    case OrderStatus.PAID:
    case OrderStatus.FULFILLING:
    case OrderStatus.COMPLETED:
      return 'PAID';
    case OrderStatus.CANCELLED:
      return 'FAILED';
    case OrderStatus.REFUNDED:
      return 'REVERSED';
    case OrderStatus.AWAITING_APPROVAL:
    case OrderStatus.DRAFT:
    default:
      return 'REVIEW_PENDING';
  }
}

export interface PublicCheckoutSummary {
  reference: string;
  state: CheckoutState;
  currency: string;
  subtotalMajorUnits: number;
  totalMajorUnits: number;
  items: { name: string; quantity: number; unitPriceMajorUnits: number; lineTotalMajorUnits: number }[];
  business: { name: string; logoUrl: string | null };
  /** Only present while the order is genuinely awaiting payment -- never
   * returned once paid/cancelled, so a stale page reload can't reopen a
   * popup for a transaction that's already resolved. */
  paystackAccessCode: string | null;
}

@Injectable()
export class PublicCheckoutService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: CommerceLedgerService,
  ) {}

  /** No tenant/auth context here by design -- a WhatsApp customer has no
   * VerzChat account. Possession of the (high-entropy, Paystack-generated)
   * reference is the authorization model, same trust boundary Paystack's own
   * hosted checkout and payment links already use. Only this order's own
   * safe, already-customer-visible fields are ever returned. */
  async getByReference(reference: string): Promise<PublicCheckoutSummary> {
    const order = await this.prisma.order.findFirst({
      where: { paystackReference: reference },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { select: { productNameSnapshot: true, quantity: true, unitPriceMajorUnitsSnapshot: true, lineTotalMajorUnits: true } },
        tenant: { select: { name: true, logoUrl: true, settings: { select: { businessName: true } } } },
      },
    });
    if (!order) throw new NotFoundException('No order found for this payment link');

    const state = toCheckoutState(order.status);
    return {
      reference,
      state,
      currency: order.currency,
      subtotalMajorUnits: order.subtotalMajorUnits,
      totalMajorUnits: order.totalMajorUnits,
      items: order.items.map((i) => ({
        name: i.productNameSnapshot,
        quantity: i.quantity,
        unitPriceMajorUnits: i.unitPriceMajorUnitsSnapshot,
        lineTotalMajorUnits: i.lineTotalMajorUnits,
      })),
      business: { name: order.tenant.settings?.businessName ?? order.tenant.name, logoUrl: order.tenant.logoUrl },
      paystackAccessCode: state === 'AWAITING_PAYMENT' ? order.paystackAccessCode : null,
    };
  }

  /** Called after the Paystack popup reports success client-side -- NOT
   * trusted on its own (spec: frontend success is not authoritative). Re-asks
   * Paystack directly via the same verified path the webhook uses, and only
   * returns a fresh, backend-confirmed state. */
  async checkStatus(reference: string): Promise<{ state: CheckoutState }> {
    const order = await this.prisma.order.findFirst({ where: { paystackReference: reference }, select: { id: true, tenantId: true, status: true } });
    if (!order) throw new NotFoundException('No order found for this payment link');

    if (order.status === OrderStatus.PENDING_PAYMENT) {
      // verifyAndRecordPayment's return shape varies by branch (its own
      // duplicate-webhook path can hand back a ledger entry, not an Order) --
      // simplest and safest is to just re-read this order's own status fresh
      // afterward, rather than depend on that method's internal union shape.
      await this.ledgerService.verifyAndRecordPayment(order.tenantId, order.id);
      const refreshed = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
      return { state: toCheckoutState(refreshed.status) };
    }
    return { state: toCheckoutState(order.status) };
  }
}
