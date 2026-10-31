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

/** A whole reply that is only an HTTP status line, e.g. "Unauthorized", "429 Too Many Requests". */
const HTTP_ERROR_LINE =
  /^\s*(?:\d{3}\s+)?(?:internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden|too many requests)\.?\s*$/i;

/**
 * Technical error output: "Error: connect ETIMEDOUT ...", "TypeError: ...", "Traceback (most recent call last)", "FATAL ...".
 * A bare "Error"/"Exception" at the start of a customer-facing apology ("Error on our side, sorry!", "Exception: we can
 * deliver on Sunday") is NOT enough; the text after the colon must look technical (an error code, status, snake_case code).
 */
const TECHNICAL_ERROR_LINE = new RegExp(
  [
    String.raw`^\s*(?:error|exception|fatal(?:\s+error)?)\s*:\s*(?:\w*(?:ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)\w*|\d{3}\b|[a-z]+(?:_[a-z]+)+\b|https?:|request failed|status code|connect\b|cannot\s|failed to\b|unexpected token|socket hang up|(?:read\s+)?timed?\s*out|undefined|null)`,
    String.raw`^\s*(?:error|exception|fatal(?:\s+error)?)\s*:\s*(?:internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden|too many requests|bad request|network error|fetch failed|something went wrong(?:\.\s*please try again(?: later)?)?)\.?\s*$`,
    String.raw`^\s*http(?:/\d(?:\.\d)?)?\s+\d{3}\b`,
    String.raw`^\s*(?:the\s+)?(?:server|api|service|request)\s+(?:returned|responded(?:\s+with)?|failed\s+with)\s*:?\s*\d{3}\b\s*[-:]?\s*(?:internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden|too many requests|not found|bad request)`,
    String.raw`^\s*exception in thread\s+"`,
    String.raw`^\s*(?:[\w$]+\.){2,}[\w$]*(?:exception|error)\b`,
    String.raw`\bat\s+(?:[\w$]+\.){2,}[\w$<>]+\([^)]*\)`,
    String.raw`^\s*traceback \(most recent call last\)`,
  ].join('|'),
  'i',
);
/** Case-sensitive on purpose: "TypeError: ..." / "AxiosError: ..." / "FATAL ..." as emitted by runtimes. */
const RUNTIME_ERROR_NAME = /^\s*(?:[A-Z]\w*(?:Error|Exception)\s*:|FATAL\b)/;

/** Provider error codes. Matched as snake_case codes, or as a short reply that is nothing but the phrase, never inside prose. */
const PROVIDER_ERROR_CODE =
  /\b(?:insufficient_quota|rate_limit_exceeded|rate_limit_error|context_length_exceeded|invalid_api_key|model_not_found|overloaded_error|content_filter)\b/i;
const PROVIDER_ERROR_PHRASE =
  /^\s*(?:you exceeded your current quota|rate limit(?:ed| exceeded| reached)?|this model's maximum context length[^\n]*|incorrect api key provided[^\n]*|the model [\w.-]+ does not exist[^\n]*|your request was rejected as a result of our safety system[^\n]*)\.?\s*$/i;

const INTERNAL_ERROR_PATTERNS: readonly RegExp[] = [
  HTTP_ERROR_LINE,
  TECHNICAL_ERROR_LINE,
  RUNTIME_ERROR_NAME,
  PROVIDER_ERROR_CODE,
  PROVIDER_ERROR_PHRASE,
  /\bat\s+[\w$.<>]+\s+\([^)]*:\d+:\d+\)/,
  /<\s*(?:!doctype|html|body|head)\b/i,
  /\[object Object\]/,
  /^\s*(?:null|undefined|nan|true|false)\s*$/i,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  /\bsk-[A-Za-z0-9]{16,}/,
];

/** The opening of a structured reply object anywhere in the text: {"response": or {"confidence": (never a bare quoted word). */
const STRUCTURED_REPLY_START = /\{\s*"(?:response|confidence)"\s*:/g;

/** Any JSON-object opener (`{"key":`). Customer-facing prose never contains one, whatever the first key is. */
const JSON_OBJECT_OPENER = /\{\s*"[\w-]+"\s*:/;

/**
 * The only shape a broken-JSON reply may have to be recovered: a "response" string that is closed, optionally with a
 * "confidence" number, and at most a missing closing brace or a cut-off confidence. Any other trailing text is refused
 * because it could change the intended answer.
 */
const RECOVERABLE_REPLY =
  /^\{\s*(?:"confidence"\s*:\s*-?\d+(?:\.\d+)?\s*,\s*)?"response"\s*:\s*"(?:\\.|[^"\\])*"\s*(?:,\s*(?:"confidence"\s*(?::\s*-?\d*(?:\.\d*)?)?)?)?\s*\}?\s*$/;

/** True for text that is JSON or looks like the start of it: an object or array with quoted keys. */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return /^[{[]/.test(t) && /"\s*:/.test(t);
}

export function checkCustomerText(text: string | null | undefined): TextCheck {
  const t = (text ?? '').trim();
  if (!t) return { safe: false, reason: 'empty' };
  if (t.length > MAX_REPLY_CHARS) return { safe: false, reason: 'too_long' };
  if (looksLikeJson(t) || JSON_OBJECT_OPENER.test(t)) return { safe: false, reason: 'malformed' };
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
    // A model often writes a real line break inside the string. That makes the object invalid JSON but the reply itself is intact, so
    // the control characters are escaped before the string is read.
    response = JSON.parse(`"${m[1].replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`) as string;
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

  // Structured parsing for output that starts as a JSON object (a leading code fence was stripped above), or where ONE
  // reply object follows ordinary non-JSON preamble ("Sure! {"response":"Hi"}"). Prose that merely quotes the word
  // "response" has no `{"response":` and is an ordinary reply. Ambiguous output is refused rather than guessed at:
  // several reply objects (one may be an example), an object nested in other JSON, or one inside an array.
  // A JSON array is never a reply, so text that starts with `[` falls through to the output check and is rejected.
  let objectAt = -1;
  if (text.startsWith('{')) {
    objectAt = 0;
  } else if (!text.startsWith('[')) {
    const openers = [...text.matchAll(STRUCTURED_REPLY_START)];
    if (openers.length > 1) return fail('malformed');
    if (openers.length === 1) {
      objectAt = openers[0].index ?? 0;
      if (/[{[]/.test(text.slice(0, objectAt))) return fail('malformed');
    }
  }
  if (objectAt >= 0) {
    const candidate = text.slice(objectAt);
    try {
      const parsed = JSON.parse(candidate) as { response?: unknown; confidence?: unknown };
      if (parsed && typeof parsed === 'object' && typeof parsed.response === 'string') {
        return accept(parsed.response, clampConfidence(parsed.confidence), false);
      }
      // Valid JSON that is not a reply: an error body such as {"error":{"message":"..."}}.
      return fail('internal_error');
    } catch {
      const closed = recoverResponse(candidate);
      if (closed && RECOVERABLE_REPLY.test(candidate.trim())) return accept(closed.response, closed.confidence, true);
      // A closed "response" string with other text around it is refused as ambiguous; an unclosed one is a cut-off
      // reply; anything else is not a reply at all. The reason is for the log only.
      if (closed) return fail('malformed');
      return fail(/"response"\s*:\s*"/.test(candidate) ? 'truncated' : 'malformed');
    }
  }

  // The model ignored the format and wrote plain prose. That is acceptable only if it is clean prose.
  return accept(text, null, false);
}

/**
 * A one-line, content-free description of a model response, for the log line written when its output is rejected: why it ended, how
 * many tokens it spent, and how long each text field was. Never the text itself. An 'empty' rejection can mean the model stopped
 * early, spent its budget on reasoning, or really returned nothing, and only these numbers tell them apart.
 */
export function describeModelResponse(data: unknown): string {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const choice = Array.isArray(body['choices']) && body['choices'][0] && typeof body['choices'][0] === 'object' ? (body['choices'][0] as Record<string, unknown>) : null;
  if (!choice) return 'no choices in the response';
  const message = choice['message'] && typeof choice['message'] === 'object' ? (choice['message'] as Record<string, unknown>) : {};
  const usage = body['usage'] && typeof body['usage'] === 'object' ? (body['usage'] as Record<string, unknown>) : {};
  const details = usage['completion_tokens_details'] && typeof usage['completion_tokens_details'] === 'object' ? (usage['completion_tokens_details'] as Record<string, unknown>) : {};
  const len = (v: unknown): string => (typeof v === 'string' ? String(v.length) : v === null || v === undefined ? 'absent' : typeof v);
  const num = (v: unknown): string => (typeof v === 'number' ? String(v) : 'n/a');
  return [
    `finish_reason=${typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : 'n/a'}`,
    `completion_tokens=${num(usage['completion_tokens'])}`,
    `reasoning_tokens=${num(details['reasoning_tokens'])}`,
    `content_chars=${len(message['content'])}`,
    `reasoning_chars=${len(message['reasoning_content'])}`,
    `tool_calls=${Array.isArray(message['tool_calls']) ? message['tool_calls'].length : 0}`,
  ].join(' ');
}

/**
 * A one-line, content-free description of the SHAPE of a model's text, for the log: how long it is, how it starts, whether it is valid
 * JSON, how many reply objects it holds, whether a line break sits inside the reply string, and what parseStructuredReply makes of it.
 * Never the text itself. It exists to say why output was refused or blanked without copying a customer's conversation into a log.
 */
export function describeReplyShape(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const t = text.trim();
  if (!t) return `chars=${text.length} blank`;
  const first = t.startsWith('{') ? 'brace' : t.startsWith('```') ? 'fence' : t.startsWith('[') ? 'bracket' : /^[A-Za-z]/.test(t) ? 'letter' : /^\d/.test(t) ? 'digit' : 'other';
  let jsonParses = false;
  try {
    JSON.parse(stripFence(t));
    jsonParses = true;
  } catch {
    jsonParses = false;
  }
  const replyObjects = (t.match(STRUCTURED_REPLY_START) ?? []).length;
  const rawControlInReply = /"response"\s*:\s*"(?:\\.|[^"\\\n\r\t])*[\n\r\t]/.test(t);
  const parsed = parseStructuredReply(t);
  return [
    `chars=${text.length}`,
    `trimmed=${t.length}`,
    `first=${first}`,
    `json_parses=${jsonParses}`,
    `reply_objects=${replyObjects}`,
    `raw_line_break_in_reply=${rawControlInReply}`,
    `parser=${parsed.ok ? (parsed.recovered ? 'recovered' : 'ok') : parsed.reason}`,
  ].join(' ');
}
