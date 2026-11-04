/**
 * Validation of tool arguments. They are MODEL OUTPUT: a model can be wrong, or steered by text in a customer message, so no argument is believed.
 * A handler must never pass a value it has not validated to a service, because a database client treats an object where a string is expected as a
 * filter ({"startsWith": ""} matches the first row), and an unbounded number or string flows straight into stored records.
 *
 * Identity (tenant, conversation, contact, phone) is NOT an argument at all: it comes from ToolExecutionContext, which the server builds.
 */
export type ToolArgs = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** An opaque record id the model is referring to (a product or order it read earlier). Anything else is not an id. */
export function argId(args: ToolArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && ID_PATTERN.test(v) ? v : undefined;
}

/** Trimmed text of at most `max` characters; undefined when absent, empty or not a string. Longer text is cut, not rejected. */
export function argText(args: ToolArgs, key: string, max: number): string | undefined {
  const v = args[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/** A whole number in [1, max]; undefined for anything else (fractions, strings such as "1e9", arrays, NaN, Infinity). */
export function argPositiveInt(args: ToolArgs, key: string, max: number): number | undefined {
  const v = args[key];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max ? v : undefined;
}

export function argTextList(args: ToolArgs, key: string, maxItems: number, maxLen: number): string[] | undefined {
  const v = args[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
  return out.length > 0 ? out : undefined;
}

/** A flat map of short text to short text; entries with non-string values are dropped. */
export function argTextRecord(args: ToolArgs, key: string, maxEntries: number, maxKey: number, maxValue: number): Record<string, string> | undefined {
  const v = args[key];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= maxEntries) break;
    if (typeof val !== 'string' || !val.trim() || !k.trim() || k.length > maxKey) continue;
    out[k.trim()] = val.trim().slice(0, maxValue);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const MAX_ORDER_QUANTITY = 10_000;
