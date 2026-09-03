import { OrderStatus } from '@prisma/client';

/**
 * Valid Order status transitions. PAID is a one-way door -- there is no
 * PAID -> PENDING_PAYMENT transition, since money already received should
 * never be silently un-received. A failed/abandoned retry after PAID would
 * need a REFUND, not a status rollback.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['FULFILLING', 'COMPLETED', 'REFUNDED'],
  FULFILLING: ['COMPLETED', 'REFUNDED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
