/**
 * Contact identity helpers. A WhatsApp address is not always a phone number: since
 * WhatsApp introduced anonymous "@lid" ids, the user part of a JID can be an opaque
 * 14-16 digit id. Treating it as a phone number (the old `jid.split('@')[0]`) creates
 * contacts with fake phones and sends replies nowhere.
 */
export type JidKind = 'phone' | 'lid' | 'group' | 'broadcast' | 'other';

export interface ClassifiedJid {
  kind: JidKind;
  /** User part of the JID, without the `:device` suffix. */
  id: string;
}

export function classifyJid(jid: string | null | undefined): ClassifiedJid {
  if (!jid || !jid.includes('@')) return { kind: 'other', id: '' };
  const [user = '', server = ''] = jid.split('@');
  const id = user.split(':')[0] ?? '';
  if (!id) return { kind: 'other', id: '' };
  if (server === 'g.us') return { kind: 'group', id };
  if (server === 'broadcast' || id === 'status') return { kind: 'broadcast', id };
  if (server === 'lid') return { kind: 'lid', id };
  if (server === 's.whatsapp.net' && isPlausiblePhoneDigits(id)) return { kind: 'phone', id };
  return { kind: 'other', id };
}

/**
 * E.164 allows at most 15 digits. Country code 1 (NANP) numbers are exactly 11 digits
 * including the country code, so a longer value starting with 1 cannot be a real number.
 */
export function isPlausiblePhoneDigits(digits: string): boolean {
  if (!/^[1-9]\d{6,14}$/.test(digits)) return false;
  if (digits.startsWith('1') && digits.length !== 11) return false;
  return true;
}

/**
 * Provider ids sometimes arrive as a "name" (e.g. `GH.1587145059558262`). A display
 * name must never be an opaque id: it is hidden from users and never used to identify
 * or merge a contact.
 */
export function looksLikeProviderId(value: string): boolean {
  return /^[A-Za-z]{0,4}[.\-_:]?\d{10,}$/.test(value.trim());
}

/** Returns a trimmed, human-meaningful name, or undefined when the value is empty or an opaque id. */
export function usableContactName(name: string | null | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (looksLikeProviderId(trimmed)) return undefined;
  return trimmed;
}
