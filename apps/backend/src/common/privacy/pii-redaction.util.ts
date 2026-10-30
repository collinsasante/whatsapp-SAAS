/**
 * Removes personal and secret data from free text before it leaves the application's trust boundary (an export for evaluation,
 * or a prompt for a provider). It is deliberately biased toward OVER-redaction: a harmless number replaced by [NUMBER] costs a
 * little context, a missed phone number or key is a privacy incident.
 *
 * It is a safety net, not a guarantee: names that are not supplied, addresses, and personal facts told in prose are NOT detected.
 * Treat redacted text as lower-risk, not as anonymous. Every scanner here is linear in the input length (no nested quantifiers),
 * because the input is untrusted customer text.
 */
export const REDACTION_VERSION = '1';

/**
 * Longest text processed per call. A WhatsApp message is at most 4096 characters; anything beyond this is cut and marked rather than
 * scanned, which bounds the worst case of the token rules (a long run that almost matches can make a regex backtrack).
 */
export const MAX_REDACT_INPUT = 8000;
export const CUT_MARKER = ' [CUT]';

export type RedactionKind = 'EMAIL' | 'URL' | 'TOKEN' | 'CARD' | 'ID' | 'PHONE' | 'NUMBER' | 'NAME';
export type RedactionCounts = Partial<Record<RedactionKind, number>>;
export interface RedactionResult { text: string; counts: RedactionCounts }
export interface RedactionOptions {
  /** Names that are known to belong to this conversation (the contact, the agents). Whole-word, case-insensitive. */
  knownNames?: ReadonlyArray<string | null | undefined>;
}

const bump = (counts: RedactionCounts, kind: RedactionKind, n = 1): void => { counts[kind] = (counts[kind] ?? 0) + n; };

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHAR = /[A-Za-z0-9.-]/;
const MAX_LOCAL = 64;
const MAX_DOMAIN = 255;

/** Finds addresses around each "@", expanding a bounded distance each way, so the cost is linear however many "@" or letters there are. */
function redactEmails(input: string, counts: RedactionCounts): string {
  if (!input.includes('@')) return input;
  let out = '';
  let cursor = 0;
  let at = input.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > cursor && at - start < MAX_LOCAL && LOCAL_CHAR.test(input[start - 1])) start--;
    let end = at + 1;
    while (end < input.length && end - at - 1 < MAX_DOMAIN && DOMAIN_CHAR.test(input[end])) end++;
    // The domain must have a dot and end in a letters-only label of 2+ characters; trailing dots or hyphens are punctuation.
    let domainEnd = end;
    while (domainEnd > at + 1 && /[.-]/.test(input[domainEnd - 1])) domainEnd--;
    const domain = input.slice(at + 1, domainEnd);
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (start < at && domain.includes('.') && /^[A-Za-z]{2,}$/.test(tld)) {
      out += input.slice(cursor, start) + '[EMAIL]';
      bump(counts, 'EMAIL');
      cursor = domainEnd;
    }
    at = input.indexOf('@', Math.max(at + 1, cursor));
  }
  return out + input.slice(cursor);
}

function replaceAll(input: string, pattern: RegExp, kind: RedactionKind, counts: RedactionCounts, replacement: string, accept?: (m: string) => boolean): string {
  return input.replace(pattern, (m) => {
    if (accept && !accept(m)) return m;
    bump(counts, kind);
    return replacement;
  });
}

const hasLetterAndDigit = (s: string): boolean => /[A-Za-z]/.test(s) && /\d/.test(s);

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const WORD_CHAR = /[A-Za-z_]/;

/** Classifies each run of digits and phone-style separators. One left-to-right pass: a run is consumed whole, so nothing is rescanned. */
function redactNumericRuns(input: string, counts: RedactionCounts): string {
  return input.replace(/[+\d][\d\s().+-]*/g, (run, offset: number, whole: string) => {
    const trimmed = run.replace(/[\s().+-]+$/, '');
    const tail = run.slice(trimmed.length);
    const before = offset > 0 ? whole[offset - 1] : '';
    const after = offset + trimmed.length < whole.length ? whole[offset + trimmed.length] : '';
    // A run glued to letters is part of a longer token (an order code, a hash); the TOKEN rule handles those, not this one.
    if ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after))) return run;
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && /^[\d\s-]+$/.test(trimmed) && luhn(digits)) { bump(counts, 'CARD'); return '[CARD]' + tail; }
    if (digits.length >= 9 && digits.length <= 15) { bump(counts, 'PHONE'); return '[PHONE]' + tail; }
    if (digits.length >= 8) { bump(counts, 'NUMBER'); return '[NUMBER]' + tail; }
    return run;
  });
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactText(value: string | null | undefined, options: RedactionOptions = {}): RedactionResult {
  const counts: RedactionCounts = {};
  let text = (value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // eslint-disable-line no-control-regex
  if (!text) return { text: '', counts };
  const cut = text.length > MAX_REDACT_INPUT;
  if (cut) text = text.slice(0, MAX_REDACT_INPUT);

  text = redactEmails(text, counts);
  text = replaceAll(text, /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi, 'URL', counts, '[URL]');
  text = replaceAll(text, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'TOKEN', counts, '[TOKEN]');
  text = replaceAll(text, /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'TOKEN', counts, '[TOKEN]');
  text = replaceAll(text, /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, 'TOKEN', counts, '[TOKEN]');
  text = replaceAll(text, /\bsk-[A-Za-z0-9_-]{16,}/g, 'TOKEN', counts, '[TOKEN]');
  text = replaceAll(text, /\b[A-Fa-f0-9]{32,}\b/g, 'TOKEN', counts, '[TOKEN]');
  text = replaceAll(text, /\b[A-Za-z0-9_-]{32,}\b/g, 'TOKEN', counts, '[TOKEN]', hasLetterAndDigit);
  text = replaceAll(text, /\bGHA-?\d{9}-?\d\b/gi, 'ID', counts, '[ID]');
  text = redactNumericRuns(text, counts);

  const names = [...new Set((options.knownNames ?? []).flatMap((n) => (n ?? '').split(/\s+/)).map((n) => n.trim()).filter((n) => n.length >= 2))];
  if (names.length > 0) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
    text = replaceAll(text, pattern, 'NAME', counts, '[NAME]');
  }
  return { text: cut ? text + CUT_MARKER : text, counts };
}

export function mergeCounts(into: RedactionCounts, from: RedactionCounts): RedactionCounts {
  for (const [k, v] of Object.entries(from)) bump(into, k as RedactionKind, v as number);
  return into;
}
