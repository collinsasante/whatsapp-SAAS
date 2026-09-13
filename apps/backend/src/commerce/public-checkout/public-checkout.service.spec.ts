import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PublicCheckoutService } from './public-checkout.service';

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    status: OrderStatus.PENDING_PAYMENT,
    currency: 'GHS',
    subtotalMajorUnits: 100,
    totalMajorUnits: 100,
    paystackAccessCode: 'access-code-abc',
    items: [{ productNameSnapshot: 'Widget', quantity: 2, unitPriceMajorUnitsSnapshot: 50, lineTotalMajorUnits: 100 }],
    tenant: { name: 'Acme Co', logoUrl: 'https://example.com/logo.png', settings: { businessName: 'Acme Commerce' } },
    ...overrides,
  };
}

function build() {
  const prisma = {
    order: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const ledgerService = { verifyAndRecordPayment: jest.fn() };
  const service = new PublicCheckoutService(prisma as never, ledgerService as never);
  return { service, prisma, ledgerService };
}

describe('PublicCheckoutService.getByReference', () => {
  it('throws NotFoundException for an unknown reference', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.getByReference('unknown-ref')).rejects.toThrow(NotFoundException);
  });

  it('never exposes the access code once the order is no longer awaiting payment', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(buildOrder({ status: OrderStatus.PAID }));
    const result = await service.getByReference('ref-1');
    expect(result.state).toBe('PAID');
    expect(result.paystackAccessCode).toBeNull();
  });

  it('exposes the access code only while genuinely awaiting payment', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(buildOrder({ status: OrderStatus.PENDING_PAYMENT }));
    const result = await service.getByReference('ref-1');
    expect(result.state).toBe('AWAITING_PAYMENT');
    expect(result.paystackAccessCode).toBe('access-code-abc');
  });

  it('prefers the tenant settings business name over the raw tenant name', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(buildOrder());
    const result = await service.getByReference('ref-1');
    expect(result.business.name).toBe('Acme Commerce');
  });

  it('falls back to the tenant name when no business name is set', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(buildOrder({ tenant: { name: 'Acme Co', logoUrl: null, settings: null } }));
    const result = await service.getByReference('ref-1');
    expect(result.business.name).toBe('Acme Co');
  });

  it('maps every OrderStatus to a coarser, honest customer-facing state', async () => {
    const { service, prisma } = build();
    const cases: [OrderStatus, string][] = [
      [OrderStatus.DRAFT, 'REVIEW_PENDING'],
      [OrderStatus.AWAITING_APPROVAL, 'REVIEW_PENDING'],
      [OrderStatus.PENDING_PAYMENT, 'AWAITING_PAYMENT'],
      [OrderStatus.PAID, 'PAID'],
      [OrderStatus.FULFILLING, 'PAID'],
      [OrderStatus.COMPLETED, 'PAID'],
      [OrderStatus.CANCELLED, 'FAILED'],
      [OrderStatus.REFUNDED, 'REVERSED'],
    ];
    for (const [status, expected] of cases) {
      prisma.order.findFirst.mockResolvedValue(buildOrder({ status }));
      const result = await service.getByReference('ref-1');
      expect(result.state).toBe(expected);
    }
  });

  it('never returns amounts or line items other than this order\'s own snapshot data', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(buildOrder());
    const result = await service.getByReference('ref-1');
    expect(result.items).toEqual([{ name: 'Widget', quantity: 2, unitPriceMajorUnits: 50, lineTotalMajorUnits: 100 }]);
    expect(result.totalMajorUnits).toBe(100);
  });
});

describe('PublicCheckoutService.checkStatus', () => {
  it('throws NotFoundException for an unknown reference', async () => {
    const { service, prisma } = build();
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.checkStatus('unknown-ref')).rejects.toThrow(NotFoundException);
  });

  it('re-verifies with the backend (never trusts the frontend) when still PENDING_PAYMENT', async () => {
    const { service, prisma, ledgerService } = build();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', tenantId: 'tenant-1', status: OrderStatus.PENDING_PAYMENT });
    ledgerService.verifyAndRecordPayment.mockResolvedValue({ verified: true, alreadyPaid: false, order: { status: OrderStatus.PAID } });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID });

    const result = await service.checkStatus('ref-1');

    expect(ledgerService.verifyAndRecordPayment).toHaveBeenCalledWith('tenant-1', 'order-1');
    expect(result.state).toBe('PAID');
  });

  it('does not re-verify with Paystack when the order is already resolved', async () => {
    const { service, prisma, ledgerService } = build();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', tenantId: 'tenant-1', status: OrderStatus.PAID });

    const result = await service.checkStatus('ref-1');

    expect(ledgerService.verifyAndRecordPayment).not.toHaveBeenCalled();
    expect(result.state).toBe('PAID');
  });
});
