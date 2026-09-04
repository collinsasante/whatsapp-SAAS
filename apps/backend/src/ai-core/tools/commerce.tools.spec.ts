import { buildCommerceTools } from './commerce.tools';

function buildOrdersMock() {
  return {
    findActiveDraftForConversation: jest.fn(),
    createDraft: jest.fn(),
    addItem: jest.fn(),
    submitForPayment: jest.fn(),
    findMostRecentForConversation: jest.fn(),
    getOwned: jest.fn(),
  };
}

const ctx = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };

function tool(orders: ReturnType<typeof buildOrdersMock>, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = buildCommerceTools(orders as any).find((t) => t.def.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}

describe('commerce.tools', () => {
  describe('add_item_to_order', () => {
    it('creates a draft order when none exists yet, then adds the item', async () => {
      const orders = buildOrdersMock();
      orders.findActiveDraftForConversation.mockResolvedValue(null);
      orders.createDraft.mockResolvedValue({ id: 'order-1' });
      orders.addItem.mockResolvedValue({ id: 'order-1', totalMajorUnits: 43, currency: 'GHS', items: [{}] });

      const result = await tool(orders, 'add_item_to_order').execute(ctx, { productId: 'p1', quantity: 20 });

      expect(orders.createDraft).toHaveBeenCalledWith('t1', { contactId: 'ct1', conversationId: 'c1', customerPhone: '+233555000111' });
      expect(orders.addItem).toHaveBeenCalledWith('t1', 'order-1', { productId: 'p1', quantity: 20, variantLabel: undefined });
      expect(result).toEqual({ orderId: 'order-1', totalMajorUnits: 43, currency: 'GHS', itemCount: 1 });
    });

    it('reuses an existing draft order instead of creating a new one', async () => {
      const orders = buildOrdersMock();
      orders.findActiveDraftForConversation.mockResolvedValue({ id: 'order-existing' });
      orders.addItem.mockResolvedValue({ id: 'order-existing', totalMajorUnits: 90, currency: 'GHS', items: [] });

      await tool(orders, 'add_item_to_order').execute(ctx, { productId: 'p1', quantity: 1 });

      expect(orders.createDraft).not.toHaveBeenCalled();
    });

    it('rejects a missing or non-positive quantity', async () => {
      const orders = buildOrdersMock();

      const result = await tool(orders, 'add_item_to_order').execute(ctx, { productId: 'p1', quantity: 0 });

      expect(result).toEqual({ error: 'productId and a positive quantity are required' });
    });
  });

  describe('submit_order_for_payment', () => {
    it('shapes an AWAITING_APPROVAL result without a checkoutUrl', async () => {
      const orders = buildOrdersMock();
      orders.findActiveDraftForConversation.mockResolvedValue({ id: 'order-1' });
      orders.submitForPayment.mockResolvedValue({ id: 'order-1', status: 'AWAITING_APPROVAL', totalMajorUnits: 43, currency: 'GHS', paystackCheckoutUrl: null });

      const result = await tool(orders, 'submit_order_for_payment').execute(ctx, {});

      expect(result).toMatchObject({ status: 'AWAITING_APPROVAL' });
      expect(result).not.toHaveProperty('checkoutUrl');
      expect((result as { note: string }).note).toContain('manager approval');
    });

    it('returns the real Paystack checkoutUrl for a normal PENDING_PAYMENT result', async () => {
      const orders = buildOrdersMock();
      orders.findActiveDraftForConversation.mockResolvedValue({ id: 'order-1' });
      orders.submitForPayment.mockResolvedValue({ id: 'order-1', status: 'PENDING_PAYMENT', totalMajorUnits: 90, currency: 'GHS', paystackCheckoutUrl: 'https://checkout.paystack.com/abc123' });

      const result = await tool(orders, 'submit_order_for_payment').execute(ctx, {});

      expect(result).toMatchObject({ status: 'PENDING_PAYMENT', checkoutUrl: 'https://checkout.paystack.com/abc123' });
    });

    it('threads dryRunPayment from the tool context through to OrdersService', async () => {
      const orders = buildOrdersMock();
      orders.findActiveDraftForConversation.mockResolvedValue({ id: 'order-1' });
      orders.submitForPayment.mockResolvedValue({ id: 'order-1', status: 'PENDING_PAYMENT', totalMajorUnits: 90, currency: 'GHS', paystackCheckoutUrl: null });

      await tool(orders, 'submit_order_for_payment').execute({ ...ctx, dryRunPayment: true }, {});

      expect(orders.submitForPayment).toHaveBeenCalledWith('t1', 'order-1', undefined, { dryRun: true });
    });
  });

  describe('get_order_status', () => {
    it('defaults to the conversation\'s most recent order when no orderId is given', async () => {
      const orders = buildOrdersMock();
      orders.findMostRecentForConversation.mockResolvedValue({ id: 'order-recent' });
      orders.getOwned.mockResolvedValue({ id: 'order-recent', status: 'PAID', paidAt: new Date(), totalMajorUnits: 90, currency: 'GHS' });

      const result = await tool(orders, 'get_order_status').execute(ctx, {});

      expect(orders.getOwned).toHaveBeenCalledWith('t1', 'order-recent');
      expect(result).toMatchObject({ orderId: 'order-recent', status: 'PAID' });
    });
  });
});
