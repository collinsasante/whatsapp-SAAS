/**
 * Recognising a saved reply (or a WhatsApp template body) that an agent sent, including one with its variables filled in
 * ("Hi {{customer_name}}, your order {{order_number}} is ready" sent as "Hi Kofi, your order 10442 is ready").
 *
 * Deliberately NOT text similarity. A saved reply matches only if the WHOLE message is the saved text, with each {{variable}}
 * standing in for a short value, so a genuine reply that merely resembles a template ("Hi Kofi, your order 10442 is ready, shall I
 * send it today?") is not excluded. The primary signal is the explicit cannedResponseId the inbox attaches; this is the backstop for
 * messages that arrive without it.
 */
const VARIABLE = /\{\{\s*\w+\s*\}\}/g;
/** A variable's value is a name, number, date, id... never a paragraph. */
const MAX_VARIABLE_CHARS = 80;
/** A template that is nearly all variables would match almost any short message. */
const MIN_LITERAL_CHARS = 12;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileSavedReply(template: string): RegExp | null {
  const normalized = squash(template);
  if (!normalized) return null;
  const parts = normalized.split(VARIABLE);
  if (parts.length === 1) return new RegExp(`^${escapeRegExp(normalized)}$`, 'i');
  const literal = parts.join('').trim();
  if (literal.length < MIN_LITERAL_CHARS) return null;
  return new RegExp(`^${parts.map(escapeRegExp).join(`.{0,${MAX_VARIABLE_CHARS}}?`)}$`, 'i');
}

export function matchesSavedReply(message: string, templates: readonly string[]): boolean {
  const text = squash(message);
  if (!text) return false;
  return templates.some((t) => compileSavedReply(t)?.test(text) ?? false);
}

/** The BODY text of a WhatsApp template's components JSON, if it has one. */
export function templateBodyText(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find((c) => c && typeof c === 'object' && (c as { type?: string }).type?.toUpperCase() === 'BODY') as { text?: unknown } | undefined;
  return typeof body?.text === 'string' ? body.text : null;
}
