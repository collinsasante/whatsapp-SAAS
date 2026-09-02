import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackGateway } from '../../billing/gateways/paystack.gateway';
import { isValidOrderTransition } from './order-state.util';

interface AddOrderItemInput {
  productId: string;
  quantity: number;
  variantLabel?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private paystack: PaystackGateway,
  ) {}

  async createDraft(tenantId: string, opts: { contactId: string; conversationId?: string; customerPhone: string; customerName?: string; currency?: string }) {
    const order = await this.prisma.order.create({
      data: {
        tenantId,
        contactId: opts.contactId,
        conversationId: opts.conversationId,
        customerPhone: opts.customerPhone,
        customerName: opts.customerName,
        currency: opts.currency ?? 'GHS',
        status: OrderStatus.DRAFT,
        subtotalMajorUnits: 0,
        totalMajorUnits: 0,
      },
    });
    await this.recordEvent(tenantId, order.id, 'CREATED');
    return order;
  }

  async addItem(tenantId: string, orderId: string, item: AddOrderItemInput) {
    const order = await this.getOwned(tenantId, orderId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new ConflictException('Items can only be added to a DRAFT order');
    }
    const product = await this.prisma.product.findFirst({ where: { id: item.productId, tenantId, isActive: true } });
    if (!product) throw new NotFoundException('Product not found or inactive');
    if (item.quantity < 1) throw new ConflictException('Quantity must be at least 1');

    const unitPrice = product.priceMajorUnits;
    const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;

    await this.prisma.orderItem.create({
      data: {
        orderId,
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceMajorUnitsSnapshot: unitPrice,
        variantLabelSnapshot: item.variantLabel,
        quantity: item.quantity,
        lineTotalMajorUnits: lineTotal,
      },
    });

    await this.recalculateTotals(orderId);
    await this.recordEvent(tenantId, orderId, 'ITEM_ADDED', { productId: product.id, quantity: item.quantity });
    return this.getOwned(tenantId, orderId);
  }

  /** Initiates payment collection via Paystack (mobile money is a Paystack checkout channel in Ghana -- no separate MTN integration needed). */
  async submitForPayment(tenantId: string, orderId: string, customerEmail?: string, opts?: { dryRun?: boolean }) {
    const order = await this.getOwned(tenantId, orderId);
    this.assertTransition(order.status, OrderStatus.PENDING_PAYMENT);
    if (order.totalMajorUnits <= 0) throw new ConflictException('Cannot submit an empty order for payment');

    // Paystack requires an email on transaction init; WhatsApp commerce customers are
    // identified by phone, not email, so synthesize a stable placeholder tied to their
    // number -- a well-established pattern for phone-first Paystack integrations.
    const email = customerEmail ?? `${order.customerPhone.replace(/[^0-9]/g, '')}@customer.verzchat.com`;

    // dryRun (used only by the AI evaluation harness): skip the real Paystack API call
    // entirely -- no live row is created in the merchant's actual Paystack account --
    // while exercising identical state-transition logic with a synthetic reference.
    const { gatewayReference, authorizationUrl } = opts?.dryRun
      ? { gatewayReference: `EVAL-${crypto.randomUUID()}`, authorizationUrl: null as string | null }
      : await this.paystack.initializeTransaction({
          email,
          amountMajorUnits: order.totalMajorUnits,
          currency: order.currency,
          tenantId,
          metadata: { orderId: order.id, source: 'managed-commerce' },
        });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PENDING_PAYMENT, paystackReference: gatewayReference, paystackCheckoutUrl: authorizationUrl },
    });
    await this.recordEvent(tenantId, orderId, 'SUBMITTED_FOR_PAYMENT');
    await this.recordEvent(tenantId, orderId, 'PAYMENT_INITIATED', { gatewayReference });
    return updated;
  }

  async cancel(tenantId: string, orderId: string, reason?: string) {
    const order = await this.getOwned(tenantId, orderId);
    this.assertTransition(order.status, OrderStatus.CANCELLED);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });
    await this.recordEvent(tenantId, orderId, 'CANCELLED', { reason });
    return updated;
  }

  async updateFulfillmentStatus(tenantId: string, orderId: string, to: OrderStatus) {
    // The one hard rule of the whole module: nothing routed through this generic
    // setter may ever set PAID. That transition exists in exactly one place --
    // CommerceLedgerService.recordPaymentSuccess -- gated behind a verified
    // gateway webhook/poll result, never an admin action or AI tool call.
    if (to === OrderStatus.PAID) {
      throw new ForbiddenException('PAID can only be set via a verified payment webhook, not this endpoint');
    }
    const order = await this.getOwned(tenantId, orderId);
    this.assertTransition(order.status, to);
    const updated = await this.prisma.order.update({ where: { id: orderId }, data: { status: to } });
    await this.recordEvent(tenantId, orderId, 'FULFILLMENT_UPDATED', { to });
    return updated;
  }

  async getOwned(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** The DRAFT order currently being built in this conversation, if any -- used by
   * CommerceAiService so the AI's tools operate on "the order we're building right
   * now" without the AI needing to track or pass an order ID itself. */
  findActiveDraftForConversation(tenantId: string, conversationId: string) {
    return this.prisma.order.findFirst({
      where: { tenantId, conversationId, status: OrderStatus.DRAFT },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  /** The most recent order in this conversation regardless of status -- used by
   * get_order_status, which must still find a PAID (or any other non-draft) order
   * to check on, unlike findActiveDraftForConversation. */
  findMostRecentForConversation(tenantId: string, conversationId: string) {
    return this.prisma.order.findFirst({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneWithDetails(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: true,
        events: { orderBy: { createdAt: 'asc' } },
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  findAll(tenantId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  private assertTransition(from: OrderStatus, to: OrderStatus) {
    if (!isValidOrderTransition(from, to)) {
      throw new ConflictException(`Invalid order transition: ${from} -> ${to}`);
    }
  }

  private async recalculateTotals(orderId: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    const subtotal = Math.round(items.reduce((sum, i) => sum + i.lineTotalMajorUnits, 0) * 100) / 100;
    // Phase 1: no separate delivery-fee/discount line -- total mirrors subtotal.
    await this.prisma.order.update({ where: { id: orderId }, data: { subtotalMajorUnits: subtotal, totalMajorUnits: subtotal } });
  }

  private async recordEvent(tenantId: string, orderId: string, type: string, data?: Record<string, unknown>) {
    await this.prisma.orderEvent.create({
      data: { tenantId, orderId, type: type as never, data: data as never },
    }).catch((err) => this.logger.warn(`Failed to record order event ${type} for ${orderId}: ${String(err)}`));
  }
}
