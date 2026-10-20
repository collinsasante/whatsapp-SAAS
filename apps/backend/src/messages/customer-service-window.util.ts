/**
 * Server-authoritative WhatsApp Cloud customer-service window: free-form sends
 * are allowed only within 24h of the customer's last INBOUND message. Agent
 * (outbound) messages never extend it. Other channels (WhatsApp Web, Messenger,
 * ...) have no such window enforced here.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function channelHasCustomerServiceWindow(channelType: string | null | undefined): boolean {
  // A conversation with no channel row is a legacy WhatsApp Cloud conversation.
  return !channelType || channelType === 'WHATSAPP';
}

/** Open while `now - lastInboundAt <= 24h` (the boundary instant itself is still open). */
export function isCustomerServiceWindowOpen(lastInboundAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= CUSTOMER_SERVICE_WINDOW_MS;
}
