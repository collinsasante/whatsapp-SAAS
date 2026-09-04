import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function buildPrismaMock() {
  return {
    order: { findFirst: jest.fn(), update: jest.fn() },
    orderItem: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    orderEvent: { create: jest.fn().mockResolvedValue(null) },
    product: { findFirst: jest.fn() },
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    paystack: { initializeTransaction: jest.fn() },
    internalTasks: { create: jest.fn().mockResolvedValue({ id: 'task-1' }), resolveByOrderId: jest.fn().mockResolvedValue(null) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new OrdersService(deps.prisma as any, deps.paystack as any, deps.internalTasks as any);
}

describe('OrdersService.submitForPayment -- minimum-quantity approval routing', () => {
  it('routes to AWAITING_APPROVAL and creates a task when an item is below its product minimum', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({
      id: 'order-1', status: 'DRAFT', totalMajorUnits: 100, currency: 'GHS',
      customerPhone: '233555000111', customerName: 'Jane', conversationId: 'conv-1', contactId: 'contact-1',
    });
    deps.prisma.orderItem.findMany.mockResolvedValue([
      { productId: 'p1', productNameSnapshot: 'Label 95x175', quantity: 20, product: { minOrderQuantity: 50 } },
    ]);
    deps.prisma.order.update.mockResolvedValue({ id: 'order-1', status: 'AWAITING_APPROVAL' });
    const service = buildService(deps);

    const result = await service.submitForPayment('t1', 'order-1');

    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(deps.paystack.initializeTransaction).not.toHaveBeenCalled();
    expect(deps.internalTasks.create).toHaveBeenCalledWith('t1', expect.objectContaining({ department: 'Orders', orderId: 'order-1' }));
  });

  it('proceeds to normal Paystack checkout when no item is below minimum', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({
      id: 'order-2', status: 'DRAFT', totalMajorUnits: 100, currency: 'GHS', customerPhone: '233555000111',
    });
    deps.prisma.orderItem.findMany.mockResolvedValue([
      { productId: 'p1', productNameSnapshot: 'Wallet', quantity: 60, product: { minOrderQuantity: 50 } },
    ]);
    deps.paystack.initializeTransaction.mockResolvedValue({ gatewayReference: 'ref-1', authorizationUrl: 'https://checkout.paystack.com/ref-1' });
    deps.prisma.order.update.mockResolvedValue({ id: 'order-2', status: 'PENDING_PAYMENT', paystackCheckoutUrl: 'https://checkout.paystack.com/ref-1' });
    const service = buildService(deps);

    const result = await service.submitForPayment('t1', 'order-2');

    expect(result.status).toBe('PENDING_PAYMENT');
    expect(deps.paystack.initializeTransaction).toHaveBeenCalledTimes(1);
    expect(deps.internalTasks.create).not.toHaveBeenCalled();
  });

  it('does not re-check the minimum when re-entering from AWAITING_APPROVAL (via approveOrder)', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({
      id: 'order-3', status: 'AWAITING_APPROVAL', totalMajorUnits: 43, currency: 'GHS', customerPhone: '233555000111',
    });
    deps.paystack.initializeTransaction.mockResolvedValue({ gatewayReference: 'ref-2', authorizationUrl: 'https://checkout.paystack.com/ref-2' });
    deps.prisma.order.update.mockResolvedValue({ id: 'order-3', status: 'PENDING_PAYMENT' });
    const service = buildService(deps);

    const result = await service.approveOrder('t1', 'order-3', 'admin-1');

    expect(deps.prisma.orderItem.findMany).not.toHaveBeenCalled();
    expect(deps.paystack.initializeTransaction).toHaveBeenCalledTimes(1);
    expect(deps.internalTasks.resolveByOrderId).toHaveBeenCalledWith('t1', 'order-3', 'admin-1', 'DONE');
    expect(result.status).toBe('PENDING_PAYMENT');
  });

  it('rejects approveOrder for an order not in AWAITING_APPROVAL', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({ id: 'order-4', status: 'DRAFT' });
    const service = buildService(deps);

    await expect(service.approveOrder('t1', 'order-4', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejectOrder cancels the order and resolves the linked task', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({ id: 'order-5', status: 'AWAITING_APPROVAL' });
    deps.prisma.order.update.mockResolvedValue({ id: 'order-5', status: 'CANCELLED' });
    const service = buildService(deps);

    const result = await service.rejectOrder('t1', 'order-5', 'admin-1', 'too small');

    expect(result.status).toBe('CANCELLED');
    expect(deps.internalTasks.resolveByOrderId).toHaveBeenCalledWith('t1', 'order-5', 'admin-1', 'CANCELLED');
  });
});

describe('OrdersService.addItem -- Verz-AI unification, Phase H', () => {
  function draftOrder() {
    return { id: 'order-1', status: 'DRAFT', tenantId: 't1' };
  }

  it('creates a new line item at the base price when no matching line exists', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue(draftOrder());
    deps.prisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Shrink Film', priceMajorUnits: 70, variants: null, isActive: true });
    const service = buildService(deps);

    await service.addItem('t1', 'order-1', { productId: 'p1', quantity: 2 });

    expect(deps.prisma.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderId: 'order-1', productId: 'p1', unitPriceMajorUnitsSnapshot: 70, quantity: 2, lineTotalMajorUnits: 140 }),
    });
    expect(deps.prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it('merges into the existing line (increments quantity) instead of creating a duplicate when called twice for the same product+variant', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue(draftOrder());
    deps.prisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Shrink Film', priceMajorUnits: 70, variants: null, isActive: true });
    deps.prisma.orderItem.findFirst.mockResolvedValue({ id: 'item-1', quantity: 2, lineTotalMajorUnits: 140 });
    const service = buildService(deps);

    await service.addItem('t1', 'order-1', { productId: 'p1', quantity: 3 });

    expect(deps.prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { quantity: 5, lineTotalMajorUnits: 350, unitPriceMajorUnitsSnapshot: 70 },
    });
    expect(deps.prisma.orderItem.create).not.toHaveBeenCalled();
  });

  it('treats different variantLabels of the same product as separate lines (does not merge)', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue(draftOrder());
    deps.prisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Shirt', priceMajorUnits: 50, variants: null, isActive: true });
    // findFirst is scoped by variantLabelSnapshot in the real query -- simulating "no match for this variant" here.
    deps.prisma.orderItem.findFirst.mockResolvedValue(null);
    const service = buildService(deps);

    await service.addItem('t1', 'order-1', { productId: 'p1', quantity: 1, variantLabel: 'Blue / Large' });

    expect(deps.prisma.orderItem.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'order-1', productId: 'p1', variantLabelSnapshot: 'Blue / Large' },
    });
    expect(deps.prisma.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ variantLabelSnapshot: 'Blue / Large' }),
    });
  });

  it('applies the matching variant price delta to the charged unit price', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue(draftOrder());
    deps.prisma.product.findFirst.mockResolvedValue({
      id: 'p1', name: 'Shirt', priceMajorUnits: 50, isActive: true,
      variants: [{ name: 'Blue / Large', priceDeltaMajorUnits: 10 }, { name: 'Blue / Small', priceDeltaMajorUnits: -5 }],
    });
    const service = buildService(deps);

    await service.addItem('t1', 'order-1', { productId: 'p1', quantity: 1, variantLabel: 'Blue / Large' });

    expect(deps.prisma.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unitPriceMajorUnitsSnapshot: 60, lineTotalMajorUnits: 60 }),
    });
  });

  it('rejects a quantity below 1', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue(draftOrder());
    deps.prisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Shirt', priceMajorUnits: 50, variants: null, isActive: true });
    const service = buildService(deps);

    await expect(service.addItem('t1', 'order-1', { productId: 'p1', quantity: 0 })).rejects.toBeInstanceOf(ConflictException);
    expect(deps.prisma.orderItem.create).not.toHaveBeenCalled();
  });

  it('rejects adding to a non-DRAFT order', async () => {
    const deps = buildDeps();
    deps.prisma.order.findFirst.mockResolvedValue({ id: 'order-1', status: 'PENDING_PAYMENT' });
    const service = buildService(deps);

    await expect(service.addItem('t1', 'order-1', { productId: 'p1', quantity: 1 })).rejects.toBeInstanceOf(ConflictException);
  });
});
