import { MessageStatus } from '@whatsapp-platform/shared-types';

const RANK: Record<string, number> = {
  [MessageStatus.QUEUED]: 0,
  [MessageStatus.SENT]: 1,
  [MessageStatus.DELIVERED]: 2,
  [MessageStatus.READ]: 3,
};

/**
 * Provider receipts arrive duplicated and out of order. Status only moves forward
 * (QUEUED < SENT < DELIVERED < READ); FAILED is accepted only before delivery, and a
 * FAILED message is never revived by a stray later receipt.
 */
export function shouldApplyStatus(current: string, incoming: string): boolean {
  if (current === MessageStatus.FAILED) return false;
  if (incoming === MessageStatus.FAILED) return (RANK[current] ?? 0) <= RANK[MessageStatus.SENT];
  return (RANK[incoming] ?? -1) > (RANK[current] ?? 0);
}
