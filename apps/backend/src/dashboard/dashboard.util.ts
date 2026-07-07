/** WhatsApp's customer-service window is 24h from the customer's last inbound message. */
const WINDOW_HOURS = 24;

/** Hours remaining in the 24h window (negative once it has closed). */
export function hoursRemainingInWindow(lastInboundAt: Date, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - lastInboundAt.getTime();
  const remainingMs = WINDOW_HOURS * 60 * 60 * 1000 - elapsedMs;
  return remainingMs / (60 * 60 * 1000);
}

/** True when the window is still open but closing within `thresholdHours` (default 4). */
export function isWindowClosingSoon(lastInboundAt: Date, now: Date = new Date(), thresholdHours = 4): boolean {
  const remaining = hoursRemainingInWindow(lastInboundAt, now);
  return remaining > 0 && remaining <= thresholdHours;
}
