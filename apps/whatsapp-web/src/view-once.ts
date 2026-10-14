/**
 * View-once media is deliberately not retrievable by the business through the official
 * WhatsApp Cloud API, and the sender chose that it should not be kept. The linked-device
 * (Baileys) socket does receive the bytes, but saving them would defeat that choice, so we
 * detect the wrapper and never download or store the media.
 */
interface WrappedMessage {
  ephemeralMessage?: { message?: WrappedMessage | null } | null;
  viewOnceMessage?: unknown;
  viewOnceMessageV2?: unknown;
  viewOnceMessageV2Extension?: unknown;
}

export const VIEW_ONCE_PLACEHOLDER = '[View-once message — open it on your phone]';

export function isViewOnceMessage(message: WrappedMessage | null | undefined): boolean {
  let current = message;
  // Disappearing-message chats wrap the view-once wrapper in an ephemeral one.
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension) return true;
    current = current.ephemeralMessage?.message ?? null;
  }
  return false;
}
