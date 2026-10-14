/**
 * Mirror of apps/backend/src/messages/customer-service-window.util.ts (the server is
 * authoritative and enforces this on send). Only WhatsApp Cloud has a 24h window that
 * starts at the customer's last INBOUND message; other channels (WhatsApp Web,
 * Messenger, ...) never show the "session expired" state.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function channelHasCustomerServiceWindow(channelType: string | null | undefined): boolean {
  return !channelType || channelType.toUpperCase() === 'WHATSAPP';
}

/** Latest known inbound time (ms) from the server-provided value and any loaded messages; 0 if unknown. */
export function latestInboundMs(...candidates: Array<string | Date | null | undefined>): number {
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    const t = new Date(c).getTime();
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return best;
}

export function isCustomerServiceWindowExpired(channelType: string | null | undefined, lastInboundMs: number, now: number = Date.now()): boolean {
  if (!channelHasCustomerServiceWindow(channelType)) return false;
  return !lastInboundMs || now - lastInboundMs > CUSTOMER_SERVICE_WINDOW_MS;
}
