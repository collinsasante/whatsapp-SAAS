export type ReceiptStatus = 'SENT' | 'DELIVERED' | 'READ';

/**
 * Baileys proto status for a message we sent: 2 = server ack (sent), 3 = delivered,
 * 4 = read, 5 = played (voice note, treated as read). 0/1 (error / pending) are not receipts.
 */
export function mapBaileysReceiptStatus(status: unknown): ReceiptStatus | undefined {
  if (typeof status !== 'number') return undefined;
  if (status >= 4) return 'READ';
  if (status === 3) return 'DELIVERED';
  if (status === 2) return 'SENT';
  return undefined;
}
