/**
 * View-once media is deliberately not retrievable by the business through the official
 * WhatsApp Cloud API, and the sender chose that it should not be kept. The linked-device
 * (Baileys) socket can receive the bytes, but saving them would defeat that choice, so we
 * detect it and never download or store the media.
 *
 * Baileys 6.17 expresses view-once in two ways, and both must be caught before any download:
 *  - wrapper messages: viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension
 *  - a `viewOnce: true` flag on imageMessage / videoMessage / audioMessage
 */
interface WrappedMessage {
  ephemeralMessage?: { message?: WrappedMessage | null } | null;
  viewOnceMessage?: unknown;
  viewOnceMessageV2?: unknown;
  viewOnceMessageV2Extension?: unknown;
  imageMessage?: { viewOnce?: boolean | null } | null;
  videoMessage?: { viewOnce?: boolean | null } | null;
  audioMessage?: { viewOnce?: boolean | null } | null;
}

export const VIEW_ONCE_PLACEHOLDER = '[View-once message. Open it on your phone]';

export function isViewOnceMessage(message: WrappedMessage | null | undefined): boolean {
  let current = message;
  // Disappearing-message chats wrap the view-once message in an ephemeral one.
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension) return true;
    if (current.imageMessage?.viewOnce || current.videoMessage?.viewOnce || current.audioMessage?.viewOnce) return true;
    current = current.ephemeralMessage?.message ?? null;
  }
  return false;
}
