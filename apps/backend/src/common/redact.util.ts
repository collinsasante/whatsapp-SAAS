/**
 * Strips likely secrets before a webhook/error payload is persisted to the
 * DB-backed monitoring tables (ErrorLog/WebhookEvent) -- these are read by
 * platform admins, not treated as a secrets store. Only touches field names
 * that are conventionally sensitive; business data (message text, amounts,
 * IDs) that reprocessing needs to work later passes through untouched.
 */
const SECRET_KEY_PATTERN = /(secret|signature|password|token|api[_-]?key|authoriz)/i;
const REDACTED = '[REDACTED]';

export function redactSecrets<T>(value: T): T {
  return redact(value, 0) as T;
}

function redact(value: unknown, depth: number): unknown {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}
