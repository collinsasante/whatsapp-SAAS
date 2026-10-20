const RESERVED = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'x-webhook-secret']);
export const MAX_CUSTOM_HEADERS = 20;

/** Returns an error message, or null when the custom headers are acceptable. */
export function validateCustomHeaders(headers: Record<string, string> | undefined | null): string | null {
  if (!headers) return null;
  const entries = Object.entries(headers);
  if (entries.length > MAX_CUSTOM_HEADERS) return `You can add up to ${MAX_CUSTOM_HEADERS} custom headers.`;
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) return `"${name.slice(0, 40)}" is not a valid header name.`;
    if (RESERVED.has(name.toLowerCase())) return `The "${name}" header is set by the system and cannot be overridden.`;
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || /[\r\n]/.test(value)) {
      return `The value for "${name}" must be 1 to 1024 characters on a single line.`;
    }
  }
  return null;
}
