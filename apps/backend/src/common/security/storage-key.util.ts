import * as path from 'path';

// Segments may contain any character except path separators and control characters, but never start with a dot (no `.`, `..`, dotfiles).
// Deliberately not limited to ASCII: keys written before extensions were sanitised can contain spaces or accents and must stay servable.
// eslint-disable-next-line no-control-regex
const SAFE_KEY = /^[^/\\\x00-\x1f.][^/\\\x00-\x1f]*(\/[^/\\\x00-\x1f.][^/\\\x00-\x1f]*)*$/;

/**
 * True only for keys shaped like the ones the app writes (`<tenantId>/<uuid>.<ext>`): path segments, none starting with a dot,
 * no `..`, no leading slash, no backslash, no control characters. Used before any key from a URL reaches storage.
 */
export function isSafeStorageKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 300 && SAFE_KEY.test(key) && !key.split('/').includes('..');
}

/** Joins a key onto the upload directory and refuses anything that resolves outside it. */
export function resolveInsideDir(baseDir: string, key: string): string {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, key);
  if (!isSafeStorageKey(key) || (full !== base && !full.startsWith(base + path.sep))) {
    throw new Error('Invalid storage key');
  }
  return full;
}

/** The extension used in a new storage key: letters and digits only, so a key is always safe to serve and to put in a URL. */
export function safeFileExtension(ext: string): string {
  const cleaned = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return cleaned ? `.${cleaned}` : '';
}
