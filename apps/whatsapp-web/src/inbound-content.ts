/**
 * Decides what an inbound WhatsApp Web (Baileys) message means for the inbox. Field names are the
 * real Baileys 6.17 proto fields (WAProto IMessage), not guesses. Pure: no I/O, no logging.
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export type InboundContent =
  | { action: 'ignore'; reason: string }
  | { action: 'deliver'; text?: string; media?: { kind: MediaKind; caption?: string; mimetype?: string }; fallback?: string };

type Loose = Record<string, unknown> | null | undefined;

// Present in the message envelope but never something a customer "said": reactions, edits and
// deletes, key exchange, history sync and similar protocol traffic.
const NON_CONTENT_KEYS = new Set([
  'protocolMessage', 'reactionMessage', 'encReactionMessage', 'pollUpdateMessage',
  'senderKeyDistributionMessage', 'fastRatchetKeySenderKeyDistributionMessage', 'messageContextInfo',
  'keepInChatMessage', 'pinInChatMessage', 'stickerSyncRmrMessage', 'placeholderMessage',
  'messageHistoryBundle', 'encEventUpdateMessage', 'encCommentMessage',
]);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

export function extractInboundContent(m: Loose): InboundContent {
  if (!m) return { action: 'ignore', reason: 'empty' };

  const present = Object.keys(m).filter((k) => m[k] != null);
  const contentKeys = present.filter((k) => !NON_CONTENT_KEYS.has(k));
  if (contentKeys.length === 0) return { action: 'ignore', reason: 'protocol-or-empty' };

  // Plain text, replies to interactive messages, and the readable body of business-style messages.
  const text =
    str(m['conversation']) ??
    str(field(m['extendedTextMessage'], 'text')) ??
    str(field(m['buttonsResponseMessage'], 'selectedDisplayText')) ??
    str(field(m['templateButtonReplyMessage'], 'selectedDisplayText')) ??
    str(field(m['listResponseMessage'], 'title')) ??
    str(field(field(m['interactiveMessage'], 'body'), 'text')) ??
    str(field(m['buttonsMessage'], 'contentText')) ??
    str(field(m['listMessage'], 'description')) ??
    str(field(m['listMessage'], 'title')) ??
    str(field(field(m['templateMessage'], 'hydratedTemplate'), 'hydratedContentText')) ??
    str(field(field(m['templateMessage'], 'hydratedFourRowTemplate'), 'hydratedContentText')) ??
    str(field(field(m['templateMessage'], 'fourRowTemplate'), 'hydratedContentText')) ??
    str(field(m['highlyStructuredMessage'], 'fallbackLg')) ??
    // A comment wraps a normal message (e.g. a reply on a channel post): its text is the comment.
    str(field(field(m['commentMessage'], 'message'), 'conversation')) ??
    str(field(field(field(m['commentMessage'], 'message'), 'extendedTextMessage'), 'text'));
  if (text) return { action: 'deliver', text };

  // Media the pipeline downloads and stores.
  const media: Array<[string, MediaKind]> = [
    ['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'audio'], ['documentMessage', 'document'],
  ];
  for (const [key, kind] of media) {
    if (m[key]) {
      return {
        action: 'deliver',
        media: { kind, caption: str(field(m[key], 'caption')), mimetype: str(field(m[key], 'mimetype')) },
      };
    }
  }

  // Types we show as a specific label rather than as "unsupported".
  if (m['stickerMessage'] || m['lottieStickerMessage']) return { action: 'deliver', fallback: '[Sticker]' };
  if (m['locationMessage'] || m['liveLocationMessage']) {
    const where = str(field(m['locationMessage'], 'name')) ?? str(field(m['locationMessage'], 'address'));
    return { action: 'deliver', fallback: where ? `[Location: ${where}]` : '[Location shared]' };
  }
  if (m['contactMessage']) {
    const who = str(field(m['contactMessage'], 'displayName'));
    return { action: 'deliver', fallback: who ? `[Contact card: ${who}]` : '[Contact card shared]' };
  }
  if (m['contactsArrayMessage']) return { action: 'deliver', fallback: '[Contact cards shared]' };
  const poll = m['pollCreationMessage'] ?? m['pollCreationMessageV2'] ?? m['pollCreationMessageV3'];
  if (poll) {
    const q = str(field(poll, 'name'));
    return { action: 'deliver', fallback: q ? `[Poll: ${q}]` : '[Poll]' };
  }
  if (m['ptvMessage']) return { action: 'deliver', fallback: '[Video message]' };
  if (m['groupInviteMessage']) return { action: 'deliver', fallback: '[Group invite]' };
  if (m['orderMessage'] || m['productMessage']) return { action: 'deliver', fallback: '[Order or product message]' };
  if (m['call'] || m['bcallMessage'] || m['scheduledCallCreationMessage']) return { action: 'deliver', fallback: '[Call]' };
  if (m['eventMessage']) {
    const name = str(field(m['eventMessage'], 'name'));
    return { action: 'deliver', fallback: name ? `[Event invitation: ${name}]` : '[Event invitation]' };
  }

  // Anything else still gets a label that names the kind of message, built from the real envelope key
  // (for example interactiveMessage -> "[Sent an interactive message]"), instead of the generic "type we can't
  // display". The label is derived from the key name only, never from message content.
  return { action: 'deliver', fallback: labelForUnknownKind(contentKeys[0]) };
}

/** "interactiveMessage" -> "[Sent an interactive message]"; "somethingNew" -> "[Sent a something new message]". */
export function labelForUnknownKind(key: string | undefined): string | undefined {
  if (!key || !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return undefined;
  const words = key.replace(/Message$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  if (!words) return undefined;
  return `[Sent ${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words} message]`;
}

/** Names of the content-bearing keys, for structure-only diagnostics. */
export function contentKeyNames(m: Loose): string[] {
  return m ? Object.keys(m).filter((k) => m[k] != null && !NON_CONTENT_KEYS.has(k)) : [];
}
