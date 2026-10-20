/**
 * Display rules for contacts. Mirrors packages/shared-utils contact-identity.ts (the frontend does
 * not depend on shared-utils). A provider id such as `GH.1587145059558262` is never shown as a name.
 */
const PROVIDER_ID = /^[A-Za-z]{0,4}[.\-_:]?\d{10,}$/;

export function looksLikeProviderId(value: string): boolean {
  return PROVIDER_ID.test(value.trim());
}

interface DisplayableContact {
  name?: string | null;
  phone?: string | null;
}

/** Real name, else phone number, else an optional fallback phone, else a neutral label. */
export function contactDisplayName(
  contact: DisplayableContact | null | undefined,
  fallbackPhone?: string | null,
  emptyLabel = 'Unknown',
): string {
  const name = contact?.name?.trim();
  if (name && !looksLikeProviderId(name)) return name;
  const phone = contact?.phone?.trim() || fallbackPhone?.trim();
  return phone || emptyLabel;
}

/** Null-safe text search over what the user can actually see for a contact. */
export function contactMatchesSearch(contact: DisplayableContact | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return contactDisplayName(contact, undefined, '').toLowerCase().includes(q) || (contact?.phone ?? '').includes(query.trim());
}
