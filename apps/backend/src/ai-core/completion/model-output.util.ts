/**
 * Defensive handling of what a model returns, so a customer never receives machine output.
 *
 * Before, a reply that was cut off at the token limit or was not valid JSON was sent verbatim:
 *   {"response":"Hello Kwame! Our shea butter comes in two sizes, 250g for GHS 45 and 500g for GH
 * Both the legacy responder and the v2 generation stage did this, and nothing stopped a provider error body,
 * an HTML error page or a stack trace from being treated as a reply either.
 *
 * parseStructuredReply is for the {"response", "confidence"} format the legacy and v2 prompts ask for.
 * checkCustomerText is for any final text (also used for tool-calling replies, which are plain text).
 * Neither makes a model call. A failure carries a reason for the log only; it is never shown to a customer.
 * What happens next is the caller's existing recovery path: no reply, a real handoff and the standard fallback text.
 */

export type ReplyProblem = 'empty' | 'truncated' | 'malformed' | 'internal_error' | 'too_long';

export type TextCheck = { safe: true } | { safe: false; reason: ReplyProblem };

export type ParsedReply =
  | { ok: true; response: string; confidence: number | null; recovered: boolean }
  | { ok: false; reason: ReplyProblem };

/** WhatsApp rejects text messages above 4096 characters. */
const MAX_REPLY_CHARS = 4096;

const INTERNAL_ERROR_PATTERNS: readonly RegExp[] = [
  /^\s*(?:error|exception|traceback|fatal|internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden)\b/i,
  /\b(?:insufficient[_ ]quota|rate[_ ]limit(?:ed| exceeded)?|context[_ ]length(?:[_ ]exceeded)?|maximum context length|invalid[_ ]api[_ ]key|incorrect api key|model[_ ]not[_ ]found|overloaded_error|content[_ ]filter(?:ed)?)\b/i,
  /\bat\s+[\w$.<>]+\s+\([^)]*:\d+:\d+\)/,
  /<\s*(?:!doctype|html|body|head)\b/i,
  /\[object Object\]/,
  /^\s*(?:null|undefined|nan|true|false)\s*$/i,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  /\bsk-[A-Za-z0-9]{16,}/,
];

/** True for text that is JSON or looks like the start of it: an object or array with quoted keys. */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return /^[{[]/.test(t) && /"\s*:/.test(t);
}

export function checkCustomerText(text: string | null | undefined): TextCheck {
  const t = (text ?? '').trim();
  if (!t) return { safe: false, reason: 'empty' };
  if (t.length > MAX_REPLY_CHARS) return { safe: false, reason: 'too_long' };
  if (looksLikeJson(t)) return { safe: false, reason: 'malformed' };
  if (INTERNAL_ERROR_PATTERNS.some((p) => p.test(t))) return { safe: false, reason: 'internal_error' };
  return { safe: true };
}

function stripFence(raw: string): string {
  return raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function clampConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
}

/** Reads a complete "response" string out of broken JSON. Returns null if the string is not closed (truncated). */
function recoverResponse(text: string): { response: string; confidence: number | null } | null {
  const m = /"response"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text);
  if (!m) return null;
  let response: string;
  try {
    response = JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
  const c = /"confidence"\s*:\s*(-?\d{1,3})(?:\.\d+)?/.exec(text);
  return { response, confidence: c ? clampConfidence(Number(c[1])) : null };
}

export function parseStructuredReply(raw: string | null | undefined): ParsedReply {
  const text = stripFence((raw ?? '').replace(/^\uFEFF/, ''));
  if (!text) return { ok: false, reason: 'empty' };

  const fail = (reason: ReplyProblem): ParsedReply => ({ ok: false, reason });
  const accept = (response: string, confidence: number | null, recovered: boolean): ParsedReply => {
    const check = checkCustomerText(response);
    return check.safe ? { ok: true, response: response.trim(), confidence, recovered } : fail(check.reason);
  };

  if (text.startsWith('{') || text.includes('"response"')) {
    try {
      const parsed = JSON.parse(text) as { response?: unknown; confidence?: unknown };
      if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string') {
        return accept(parsed.response, clampConfidence(parsed.confidence), false);
      }
      // Valid JSON that is not a reply: an error body such as {"error":{"message":"..."}}.
      return fail('internal_error');
    } catch {
      const recovered = recoverResponse(text);
      if (recovered) return accept(recovered.response, recovered.confidence, true);
      // An unclosed "response" string is a cut-off reply; anything else is not a reply at all.
      return fail(/"response"\s*:\s*"/.test(text) ? 'truncated' : 'malformed');
    }
  }

  // The model ignored the format and wrote plain prose. That is acceptable only if it is clean prose.
  return accept(text, null, false);
}
