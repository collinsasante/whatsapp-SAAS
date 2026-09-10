import { ToolCallTrace } from './tool-calling.service';

/** Second hardening pass, Section 2: this is what gets persisted to
 * AiExecution.toolTrace -- one entry per tool call, in execution order. */
export interface SanitizedToolCall {
  name: string;
  order: number;
  input: unknown;
  result: unknown;
  success: boolean;
  errorMessage?: string;
  durationMs: number | null;
}

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|authorization|auth[_-]?header|credential|private[_-]?key)/i;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 6;

/** Recursively redacts secret-shaped keys and truncates oversized values, at any
 * depth -- never assumes a tool's input/output shape, since new tools get this for
 * free without the sanitizer needing updating. Never throws: an unsanitizable value
 * (e.g. a circular reference) becomes a placeholder string rather than blocking the
 * whole trace from being persisted. */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max depth exceeded]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const truncated = value.length > MAX_ARRAY_ITEMS;
    const items = (truncated ? value.slice(0, MAX_ARRAY_ITEMS) : value).map((v) => sanitizeValue(v, depth + 1));
    return truncated ? [...items, `… ${value.length - MAX_ARRAY_ITEMS} more items truncated`] : items;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(v, depth + 1);
    }
    return out;
  }

  // function, symbol, bigint, etc -- shouldn't occur in tool args/results, but
  // never let an unexpected type break persistence.
  return String(value);
}

function isFailureResult(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'error' in (result as Record<string, unknown>);
}

export function sanitizeToolTrace(trace: ToolCallTrace[]): SanitizedToolCall[] {
  try {
    return trace.map((call, i) => {
      const sanitizedResult = sanitizeValue(call.result);
      const failed = isFailureResult(call.result);
      return {
        name: call.name,
        order: i,
        input: sanitizeValue(call.args),
        result: sanitizedResult,
        success: !failed,
        ...(failed && { errorMessage: String((call.result as Record<string, unknown>)['error']).slice(0, MAX_STRING_LENGTH) }),
        durationMs: call.durationMs ?? null,
      };
    });
  } catch {
    // Never let a sanitization bug take down the AI turn it's describing.
    return [];
  }
}
