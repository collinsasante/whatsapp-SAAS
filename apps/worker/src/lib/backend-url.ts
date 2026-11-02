const DEFAULT_BACKEND = 'http://backend:3001';
const API_PREFIX = '/api/v1';

/**
 * Base URL for the worker's calls to the backend's own HTTP API. The backend serves every route under /api/v1, but BACKEND_URL (and
 * its default) historically held only the host, so internal notifications went to a path that does not exist and failed with a 404
 * that the callers swallowed. Accepts either form and always returns the prefixed one.
 */
export function backendApiBase(raw: string | undefined = process.env['BACKEND_URL']): string {
  const base = (raw?.trim() || DEFAULT_BACKEND).replace(/\/+$/, '');
  return base.endsWith(API_PREFIX) ? base : `${base}${API_PREFIX}`;
}
