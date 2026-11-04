/**
 * Redaction at the boundary where text leaves the application for a model provider, a log line or a stored diagnostic.
 *
 * Two classes, handled differently on purpose:
 *  - SECRETS (API keys, bearer/JWT tokens, signed-URL parameters, "password: x" values, card numbers, opaque long tokens) are replaced irreversibly
 *    ([SECRET], [CARD]). No code path restores them, so a model can never echo one back.
 *  - PERSONAL CONTACT DETAILS (email addresses, phone numbers) are replaced by numbered placeholders ([EMAIL_1], [PHONE_2]) so the model keeps the
 *    context ("the customer gave a number, send it to the team") without seeing the value. For a model call the session can RESTORE them in the
 *    model's reply and tool arguments, because that reply goes back to the same customer and the tools act on that customer's own record. For
 *    logs and diagnostics there is no session: they become [EMAIL] / [PHONE] and are never restored.
 *
 * It is a safety net, not anonymisation: names, addresses and facts told in prose are NOT detected. Phone detection is heuristic (international
 * "+" numbers, numbers starting with 0, and long digit runs) so that dates, amounts and order numbers survive. Every scanner is linear or bounded in
 * the input length because the input is untrusted customer text.
 */
export const MAX_SCAN_CHARS = 60_000;
const CUT = ' [CUT]';

export interface RedactionStats { secrets: number; cards: number; emails: number; phones: number }
const newStats = (): RedactionStats => ({ secrets: 0, cards: 0, emails: 0, phones: 0 });

const SECRET_WORDS = '(?:api[_ -]?key|apikey|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|token|bearer|password|passwd|pwd|passcode|pin|otp|cvv|cvc|private[_ -]?key)';

/** Value shapes that are credentials wherever they appear. Order matters: the specific ones run before the generic long-token rule. */
const SECRET_SHAPES: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,                   // JWT
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{16,}/g,                         // sk-..., sk_live_...
  /\bEA[A-Z][A-Za-z0-9]{30,}/g,                                                           // Meta access tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                                                // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g,                                                            // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                                                      // Slack
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,                                                        // GitHub
  /\bwhsec_[A-Za-z0-9]{16,}/g,                                                            // webhook signing secrets
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,                                                    // Telegram bot tokens
  /\benc:v1:[A-Za-z0-9+/=_-]{10,}/g,                                                      // this app's own ciphertext
];

// "password: hunter2", "api key = abc123...", "my pin is 4821". The label is kept so the model still understands what was shared.
const LABELLED_SECRET = new RegExp(`(\\b${SECRET_WORDS}\\b\\s*(?:[:=]|\\bis\\b)\\s*)(["']?)([^\\s"',;]{3,})\\2`, 'gi');
// Credentials carried in URLs: ?token=..., &signature=..., X-Amz-Signature=...
const URL_SECRET_PARAM = /([?&;](?:access[_-]?token|token|key|api[_-]?key|signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token|expires?|auth|password|secret)=)[^\s&"'<>]+/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/@]{1,100}:[^\s/@]{1,100}@/gi;
// A long run of base64/hex-looking characters that mixes letters and digits is an opaque credential, not a word.
const LONG_OPAQUE = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]{32,})(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const CARD_CANDIDATE = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,6}(?![A-Za-z0-9-])/g;
const PHONE_CANDIDATE = /(?<![\w@.+/-])\+?\(?\d[\d\s().-]{7,18}\d(?![\w@])/g;

function luhn(digits: string): boolean {
  let sum = 0; let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Phone-like, but not a date, a time, an amount or a card. */
function looksLikePhone(m: string): boolean {
  const digits = m.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(m) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(m)) return false;   // dates
  const t = m.trim();
  if (t.startsWith('+')) return true;
  if (t.startsWith('0') || t.startsWith('(0')) return true;
  if (/^\d+$/.test(t)) return digits.length >= 11;                                  // a bare long digit run
  return /[\s().-]/.test(t) && digits.length >= 10 && /^\(?\d{2,4}\)?[\s.-]\d/.test(t);
}

function redactSecretsIn(text: string, stats: RedactionStats): string {
  let out = text;
  for (const re of SECRET_SHAPES) out = out.replace(re, () => { stats.secrets++; return '[SECRET]'; });
  out = out.replace(URL_USERINFO, (_m, scheme: string) => { stats.secrets++; return `${scheme}[SECRET]@`; });
  out = out.replace(URL_SECRET_PARAM, (_m, p: string) => { stats.secrets++; return `${p}[SECRET]`; });
  out = out.replace(LABELLED_SECRET, (_m, label: string) => { stats.secrets++; return `${label}[SECRET]`; });
  out = out.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    stats.cards++; return '[CARD]';
  });
  out = out.replace(LONG_OPAQUE, () => { stats.secrets++; return '[SECRET]'; });
  return out;
}

function bound(text: string): string { return text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) + CUT : text; }

/** One model call's worth of redaction: the same value always gets the same placeholder, and the session can put the originals back. */
export class PromptRedactionSession {
  readonly stats = newStats();
  private readonly byValue = new Map<string, string>();
  private readonly byPlaceholder = new Map<string, string>();
  private counters = { EMAIL: 0, PHONE: 0 };

  private placeholder(kind: 'EMAIL' | 'PHONE', value: string): string {
    const key = `${kind}:${value.toLowerCase()}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const ph = `[${kind}_${++this.counters[kind]}]`;
    this.byValue.set(key, ph);
    this.byPlaceholder.set(ph, value);
    return ph;
  }

  redact(text: string): string {
    if (!text) return text;
    let out = redactSecretsIn(bound(text), this.stats);
    out = out.replace(EMAIL, (m) => { this.stats.emails++; return this.placeholder('EMAIL', m); });
    out = out.replace(PHONE_CANDIDATE, (m) => {
      if (!looksLikePhone(m)) return m;
      this.stats.phones++;
      // keep any leading/trailing separator characters that are not part of the number
      return this.placeholder('PHONE', m.trim());
    });
    return out;
  }

  /** Puts back only placeholders this session issued. A placeholder the model invented stays as it is (it maps to nothing). Secrets are never restorable. */
  restore(text: string): string {
    if (!text || this.byPlaceholder.size === 0) return text;
    return text.replace(/\[(?:EMAIL|PHONE)_\d{1,4}\]/g, (ph) => this.byPlaceholder.get(ph) ?? ph);
  }

  /** True when `text` still contains a placeholder this session never issued (the model made one up). */
  hasUnknownPlaceholder(text: string): boolean {
    return (text.match(/\[(?:EMAIL|PHONE)_\d{1,4}\]/g) ?? []).some((ph) => !this.byPlaceholder.has(ph));
  }
}

/** Redacts an array of chat messages (content and any tool-call arguments) without mutating the input. */
export function redactChatMessages<M extends { content?: string | null; toolCalls?: Array<{ arguments: string }> }>(messages: M[], session: PromptRedactionSession): M[] {
  return messages.map((m) => ({
    ...m,
    ...(typeof m.content === 'string' && { content: session.redact(m.content) }),
    ...(m.toolCalls && { toolCalls: m.toolCalls.map((tc) => ({ ...tc, arguments: session.redact(tc.arguments) })) }),
  }));
}

/**
 * Irreversible redaction for logs, traces and stored diagnostics: secrets as above, emails and phones as [EMAIL] / [PHONE]. Never throws; on any
 * internal failure it returns a fixed placeholder rather than the original text.
 */
export function redactForDiagnostics(text: string): string {
  try {
    const stats = newStats();
    let out = redactSecretsIn(bound(text), stats);
    out = out.replace(EMAIL, '[EMAIL]');
    out = out.replace(PHONE_CANDIDATE, (m) => (looksLikePhone(m) ? '[PHONE]' : m));
    return out;
  } catch {
    return '[unprintable]';
  }
}

/** Recursively applies redactForDiagnostics to every string in a JSON-like value (and redacts secret-named keys wholesale). */
const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|auth[_-]?header|credential|private[_-]?key|signature|cookie)/i;
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max depth exceeded]';
  if (typeof value === 'string') return redactForDiagnostics(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactDeep(v, depth + 1);
    return out;
  }
  return value;
}

/**
 * What is safe to log about an error from an HTTP client: its kind and status, never its message body, request config, headers (which carry the API
 * key) or the prompt. Axios errors serialise their whole request, so an error object must never be passed to a logger directly.
 */
export function describeErrorForLog(err: unknown): string {
  if (!err || typeof err !== 'object') return typeof err === 'string' ? redactForDiagnostics(err).slice(0, 120) : 'error';
  const e = err as { name?: unknown; code?: unknown; response?: { status?: unknown }; status?: unknown; message?: unknown };
  const parts = [typeof e.name === 'string' ? e.name : 'Error'];
  if (typeof e.code === 'string') parts.push(`code=${e.code.slice(0, 40)}`);
  const status = e.response?.status ?? e.status;
  if (typeof status === 'number') parts.push(`status=${status}`);
  // Only messages that are plain error text; anything that looks like it carries a request body is dropped.
  if (typeof e.message === 'string' && e.message.length <= 160 && !/[{}]/.test(e.message)) parts.push(redactForDiagnostics(e.message));
  return parts.join(' ');
}
