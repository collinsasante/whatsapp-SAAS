/** Normalises a Telegram Bot API `Update` into the small shape the inbox needs. Pure; no I/O. */
export type TelegramAttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface TelegramInboundAttachment { kind: TelegramAttachmentKind; fileId: string; fileSize?: number; mimeType?: string; fileName?: string }

export interface TelegramInbound {
  chatId: string;
  messageId: number;
  senderName?: string;
  /** What the person typed (message text, or the caption of a media message). */
  text?: string;
  /** Shown when there is nothing else (a sticker, a shared location ...). */
  placeholder?: string;
  attachment?: TelegramInboundAttachment;
  dateMs?: number;
}

export type TelegramNormalised = { ok: true; inbound: TelegramInbound } | { ok: false; reason: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normaliseTelegramUpdate(update: unknown): TelegramNormalised {
  if (!isObj(update)) return { ok: false, reason: 'not-an-update' };
  // Only plain new messages. Edits, channel posts, callback queries, member changes ... are acknowledged and ignored.
  const m = update['message'];
  if (!isObj(m)) return { ok: false, reason: 'not-a-message' };
  const chat = m['chat']; const from = m['from'];
  if (!isObj(chat) || (typeof chat['id'] !== 'number' && typeof chat['id'] !== 'string')) return { ok: false, reason: 'no-chat' };
  if (chat['type'] !== 'private') return { ok: false, reason: 'not-private-chat' };   // groups and channels are out of scope
  if (isObj(from) && from['is_bot'] === true) return { ok: false, reason: 'from-bot' };
  const messageId = num(m['message_id']);
  if (messageId === undefined) return { ok: false, reason: 'no-message-id' };

  const name = isObj(from)
    ? ([str(from['first_name']), str(from['last_name'])].filter(Boolean).join(' ').trim() || (str(from['username']) ? `@${str(from['username'])}` : undefined))
    : undefined;
  const text = str(m['text']) ?? str(m['caption']);
  const date = num(m['date']);
  const base = { chatId: String(chat['id']), messageId, senderName: name, text, dateMs: date !== undefined ? date * 1000 : undefined } as const;

  const photo = m['photo'];
  if (Array.isArray(photo) && photo.length > 0) {
    // sizes ascending; take the largest that has a file id
    const best = [...photo].filter(isObj).sort((a, b) => (num(b['file_size']) ?? 0) - (num(a['file_size']) ?? 0))[0];
    const id = best && str(best['file_id']);
    if (id) return { ok: true, inbound: { ...base, attachment: { kind: 'image', fileId: id, fileSize: num(best['file_size']), mimeType: 'image/jpeg' } } };
  }
  const media: Array<[string, TelegramAttachmentKind]> = [['voice', 'audio'], ['audio', 'audio'], ['video', 'video'], ['video_note', 'video'], ['animation', 'video'], ['document', 'file']];
  for (const [key, kind] of media) {
    const o = m[key];
    if (isObj(o) && str(o['file_id'])) {
      return { ok: true, inbound: { ...base, attachment: { kind, fileId: str(o['file_id'])!, fileSize: num(o['file_size']), mimeType: str(o['mime_type']), fileName: str(o['file_name']) } } };
    }
  }
  if (isObj(m['sticker'])) return { ok: true, inbound: { ...base, placeholder: `[Sticker${str((m['sticker'] as Obj)['emoji']) ? ` ${str((m['sticker'] as Obj)['emoji'])}` : ''}]` } };
  if (isObj(m['location'])) return { ok: true, inbound: { ...base, placeholder: '[Shared a location]' } };
  if (isObj(m['contact'])) return { ok: true, inbound: { ...base, placeholder: '[Shared a contact]' } };
  if (isObj(m['poll'])) return { ok: true, inbound: { ...base, placeholder: '[Sent a poll]' } };
  if (!text) return { ok: true, inbound: { ...base, placeholder: '[Sent a message type we can\'t display yet]' } };
  return { ok: true, inbound: base };
}

/** The id stored on the message (unique per tenant): bot, chat and Telegram message id. Inbound and outbound use the same format. */
export const telegramMessageKey = (botId: string, chatId: string, messageId: number | string): string => `tg:${botId}:${chatId}:${messageId}`;
export const telegramMessageIdFromKey = (key: string | undefined | null): number | undefined => {
  const m = typeof key === 'string' ? /^tg:[^:]+:[^:]+:(\d+)$/.exec(key) : null;
  return m ? Number(m[1]) : undefined;
};
