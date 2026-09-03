import { OrdersService } from '../../commerce/orders/orders.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/** Migrated verbatim from CommerceAiService.executeTool's order-related cases -- same
 * OrdersService calls, same AWAITING_APPROVAL handling, same result shapes. The hard
 * payment boundary is unchanged: nothing here can set Order.status = PAID (that's
 * CommerceLedgerService.recordPaymentSuccess only, gated by a verified gateway webhook). */
export function buildCommerceTools(orders: OrdersService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'add_item_to_order',
        description: "Add a product to the customer's current order (creates the order if this is the first item). Call this once the customer has confirmed what they want to buy and how many.",
        parameters: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            variantLabel: { type: 'string', description: 'Optional variant, e.g. "Large / Red"' },
          },
          required: ['productId', 'quantity'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const productId = args['productId'] as string;
        const quantity = Number(args['quantity']);
        if (!productId || !quantity || quantity < 1) return { error: 'productId and a positive quantity are required' };

        let order = await orders.findActiveDraftForConversation(ctx.tenantId, ctx.conversationId);
        if (!order) {
          order = await orders.createDraft(ctx.tenantId, { contactId: ctx.contactId, conversationId: ctx.conversationId, customerPhone: ctx.customerPhone }) as never;
        }
        const updated = await orders.addItem(ctx.tenantId, order!.id, { productId, quantity, variantLabel: args['variantLabel'] as string | undefined });
        return { orderId: updated.id, totalMajorUnits: updated.totalMajorUnits, currency: updated.currency, itemCount: (updated as unknown as { items: unknown[] }).items?.length };
      },
    },
    {
      def: {
        name: 'get_current_order',
        description: "Get the current draft order's items and running total, e.g. to read it back to the customer before checkout.",
        parameters: { type: 'object', properties: {} },
      },
      execute: async (ctx: ToolExecutionContext) => {
        const order = await orders.findActiveDraftForConversation(ctx.tenantId, ctx.conversationId);
        if (!order) return { error: 'No order has been started yet' };
        return { orderId: order.id, items: order.items.map((i) => ({ product: i.productNameSnapshot, quantity: i.quantity, lineTotal: i.lineTotalMajorUnits })), totalMajorUnits: order.totalMajorUnits, currency: order.currency };
      },
    },
    {
      def: {
        name: 'submit_order_for_payment',
        description: 'Finalize the current draft order and get a real payment link to send the customer. Only call this once the customer has explicitly confirmed they want to check out.',
        parameters: { type: 'object', properties: {} },
      },
      execute: async (ctx: ToolExecutionContext) => {
        const order = await orders.findActiveDraftForConversation(ctx.tenantId, ctx.conversationId);
        if (!order) return { error: 'No order has been started yet' };
        const updated = await orders.submitForPayment(ctx.tenantId, order.id, undefined, { dryRun: ctx.dryRunPayment });
        if (updated.status === 'AWAITING_APPROVAL') {
          return { orderId: updated.id, status: updated.status, totalMajorUnits: updated.totalMajorUnits, currency: updated.currency, note: 'Below the minimum order quantity for at least one item -- sent for manager approval, no payment link yet.' };
        }
        // paystackCheckoutUrl is Paystack's own authorization_url from initializeTransaction --
        // https://checkout.paystack.com/<reference> is not a valid URL pattern and was
        // sending customers to a broken "we could not start this transaction" page.
        return { orderId: updated.id, status: updated.status, totalMajorUnits: updated.totalMajorUnits, currency: updated.currency, checkoutUrl: updated.paystackCheckoutUrl };
      },
    },
    {
      def: {
        name: 'get_order_status',
        description: "Check whether an order has actually been paid. ALWAYS call this before telling a customer their payment went through -- never state a payment succeeded from memory or assumption.",
        parameters: {
          type: 'object',
          properties: { orderId: { type: 'string', description: 'Omit to check the current conversation\'s most recent order.' } },
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const orderId = (args['orderId'] as string | undefined) ?? (await orders.findMostRecentForConversation(ctx.tenantId, ctx.conversationId))?.id;
        if (!orderId) return { error: 'No order to check' };
        const order = await orders.getOwned(ctx.tenantId, orderId).catch(() => null);
        if (!order) return { error: 'Order not found' };
        return { orderId: order.id, status: order.status, paidAt: order.paidAt, totalMajorUnits: order.totalMajorUnits, currency: order.currency };
      },
    },
  ];
}
