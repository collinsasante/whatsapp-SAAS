import { OrderStatus } from '@prisma/client';
import { isValidOrderTransition, ORDER_TRANSITIONS } from './order-state.util';

const ALL_STATUSES: OrderStatus[] = ['DRAFT', 'PENDING_PAYMENT', 'PAID', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

describe('isValidOrderTransition', () => {
  it.each([
    ['DRAFT', 'PENDING_PAYMENT'],
    ['DRAFT', 'CANCELLED'],
    ['PENDING_PAYMENT', 'PAID'],
    ['PENDING_PAYMENT', 'CANCELLED'],
    ['PAID', 'FULFILLING'],
    ['PAID', 'COMPLETED'],
    ['PAID', 'REFUNDED'],
    ['FULFILLING', 'COMPLETED'],
    ['FULFILLING', 'REFUNDED'],
    ['COMPLETED', 'REFUNDED'],
  ] as [OrderStatus, OrderStatus][])('allows %s -> %s', (from, to) => {
    expect(isValidOrderTransition(from, to)).toBe(true);
  });

  it('rejects PAID -> PENDING_PAYMENT -- money received is a one-way door', () => {
    expect(isValidOrderTransition('PAID', 'PENDING_PAYMENT')).toBe(false);
  });

  it('rejects DRAFT -> PAID -- cannot skip PENDING_PAYMENT', () => {
    expect(isValidOrderTransition('DRAFT', 'PAID')).toBe(false);
  });

  it('rejects any transition out of CANCELLED', () => {
    for (const to of ALL_STATUSES) {
      expect(isValidOrderTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('rejects any transition out of REFUNDED', () => {
    for (const to of ALL_STATUSES) {
      expect(isValidOrderTransition('REFUNDED', to)).toBe(false);
    }
  });

  it('rejects same-state no-ops', () => {
    for (const status of ALL_STATUSES) {
      expect(isValidOrderTransition(status, status)).toBe(false);
    }
  });

  it('every status has an explicit (possibly empty) transition list -- no silent undefined fallthrough', () => {
    for (const status of ALL_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
  });
});
