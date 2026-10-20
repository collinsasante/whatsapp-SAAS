export interface PreviewMessage {
  content?: string | null;
  type?: string | null;
  direction?: string | null;
  createdAt?: string | null;
}

export interface ConversationPreviewData {
  name: string;
  /** Text to show, or null when the latest message has nothing readable (empty chat, unsupported type). */
  body: string | null;
  /** Set for media-only messages ("Photo", "Voice message"...). */
  mediaLabel: string | null;
  direction: 'INBOUND' | 'OUTBOUND' | null;
  /** ISO timestamp of the latest activity, when known. */
  time: string | null;
}

const MEDIA_LABELS: Record<string, string> = {
  IMAGE: 'Photo',
  VIDEO: 'Video',
  AUDIO: 'Voice message',
  DOCUMENT: 'Document',
  LOCATION: 'Location',
  CONTACTS: 'Contact card',
};

export const PREVIEW_MAX_CHARS = 300;

/**
 * Builds the hover/focus preview from the conversation row that is already loaded. It is read-only by design:
 * no request is made, so previewing can never mark a chat as read or change its state.
 */
export function buildConversationPreview(input: {
  name: string;
  lastMessage?: PreviewMessage | null;
  lastMessageAt?: string | null;
}): ConversationPreviewData {
  const msg = input.lastMessage ?? null;
  const text = msg?.content?.trim() ? msg.content.trim() : null;
  const body = text && text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}...` : text;
  const mediaLabel = !text && msg?.type ? (MEDIA_LABELS[msg.type] ?? null) : null;
  const direction = msg?.direction === 'INBOUND' || msg?.direction === 'OUTBOUND' ? msg.direction : null;
  return {
    name: input.name,
    body,
    mediaLabel,
    direction: msg ? direction : null,
    time: input.lastMessageAt ?? msg?.createdAt ?? null,
  };
}

export interface PreviewPlacement {
  left: number;
  top: number;
}

/** Puts the card beside the row when there is room, otherwise below (or above) it, always inside the viewport. */
export function placePreview(
  anchor: { top: number; right: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): PreviewPlacement {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  if (anchor.right + gap + card.width <= viewport.width - gap) {
    return { left: anchor.right + gap, top: clamp(anchor.top, gap, viewport.height - card.height - gap) };
  }
  const left = clamp(anchor.left, gap, viewport.width - card.width - gap);
  const below = anchor.bottom + gap;
  const top = below + card.height <= viewport.height - gap ? below : Math.max(gap, anchor.top - card.height - gap);
  return { left, top };
}
