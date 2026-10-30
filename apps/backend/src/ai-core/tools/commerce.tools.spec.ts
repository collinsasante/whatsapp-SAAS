import { buildCommerceTools } from './commerce.tools';

function buildOrdersMock() {
  return {
    findActiveDraftForConversation: jest.fn(),
    createDraft: jest.fn(),
    addItem: jest.fn(),
    submitForPayment: jest.fn(),
    findMostRecentForConversation: jest.fn(),
    findOwnedByContact: jest.fn(),
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
    const paid = { id: 'order-recent', contactId: 'ct1', status: 'PAID', paidAt: new Date(), totalMajorUnits: 90, currency: 'GHS' };

    it("defaults to the conversation's most recent order when no orderId is given", async () => {
      const orders = buildOrdersMock();
      orders.findMostRecentForConversation.mockResolvedValue(paid);

      const result = await tool(orders, 'get_order_status').execute(ctx, {});

      expect(orders.findMostRecentForConversation).toHaveBeenCalledWith('t1', 'c1');
      expect(result).toMatchObject({ orderId: 'order-recent', status: 'PAID' });
    });

    it('returns an explicitly requested order only through the workspace + contact lookup', async () => {
      const orders = buildOrdersMock();
      orders.findOwnedByContact.mockResolvedValue({ ...paid, id: 'order-7' });

      const result = await tool(orders, 'get_order_status').execute(ctx, { orderId: 'order-7' });

      expect(orders.findOwnedByContact).toHaveBeenCalledWith('t1', 'ct1', 'order-7');
      expect(orders.getOwned).not.toHaveBeenCalled();
      expect(result).toMatchObject({ orderId: 'order-7', status: 'PAID' });
    });

    it("gives the same safe answer for another contact's order, another workspace's order, and an order that does not exist", async () => {
      const orders = buildOrdersMock();
      orders.findOwnedByContact.mockResolvedValue(null); // a miss is a miss, whatever the reason
      const run = (orderId: string) => tool(orders, 'get_order_status').execute(ctx, { orderId });

      const sameWorkspaceOtherContact = await run('order-of-someone-else');
      const otherWorkspace = await run('order-in-workspace-t2');
      const missing = await run('no-such-order');

      expect(sameWorkspaceOtherContact).toEqual({ error: 'Order not found' });
      expect(otherWorkspace).toEqual({ error: 'Order not found' });
      expect(missing).toEqual({ error: 'Order not found' });
      expect(JSON.stringify([sameWorkspaceOtherContact, otherWorkspace])).not.toMatch(/PAID|totalMajorUnits|ct2|status/);
    });

    it('takes the contact from the conversation context, never from model-supplied arguments', async () => {
      const orders = buildOrdersMock();
      orders.findOwnedByContact.mockResolvedValue(null);

      await tool(orders, 'get_order_status').execute(ctx, { orderId: 'order-7', contactId: 'ct-attacker', tenantId: 't-attacker' });

      expect(orders.findOwnedByContact).toHaveBeenCalledWith('t1', 'ct1', 'order-7');
    });

    it("refuses even the conversation's most recent order if it belongs to a different contact", async () => {
      const orders = buildOrdersMock();
      orders.findMostRecentForConversation.mockResolvedValue({ ...paid, contactId: 'ct2' });

      const result = await tool(orders, 'get_order_status').execute(ctx, {});

      expect(result).toEqual({ error: 'Order not found' });
    });

    it('says there is nothing to check when the conversation has no order', async () => {
      const orders = buildOrdersMock();
      orders.findMostRecentForConversation.mockResolvedValue(null);
      expect(await tool(orders, 'get_order_status').execute(ctx, {})).toEqual({ error: 'No order to check' });
    });

    it('ignores a non-string orderId instead of passing it to the database', async () => {
      const orders = buildOrdersMock();
      orders.findMostRecentForConversation.mockResolvedValue(null);
      await tool(orders, 'get_order_status').execute(ctx, { orderId: { contains: '' } });
      expect(orders.findOwnedByContact).not.toHaveBeenCalled();
    });
  });
});
