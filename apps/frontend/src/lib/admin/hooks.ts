'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** True during the first load and during any reload. */
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data when the inputs change. Keeps the previous data on screen while a reload is running (so a filter change
 * does not blank the table), and ignores a response that arrives after a newer request was made.
 */
export function useAdminData<T>(load: () => Promise<T>, deps: ReadonlyArray<unknown>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    load()
      .then((result) => { if (id === latest.current) setData(result); })
      .catch((err: unknown) => { if (id === latest.current) setError(err instanceof Error ? err.message : 'Request failed'); })
      .finally(() => { if (id === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/**
 * Filter state kept in the address bar, so a filtered view can be shared, survives a refresh, and works with the back
 * button. Setting a value to '' removes it. Changing any filter returns to the first page.
 */
export function useUrlState(defaults: Record<string, string> = {}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();

  const get = useCallback((key: string) => params?.get(key) ?? defaults[key] ?? '', [params, defaults]);

  const set = useCallback((next: Record<string, string>, options: { keepPage?: boolean } = {}) => {
    const search = new URLSearchParams(params?.toString() ?? '');
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === defaults[key]) search.delete(key);
      else search.set(key, value);
    }
    if (!options.keepPage && !('page' in next)) search.delete('page');
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, defaults, router, pathname]);

  return { get, set };
}

/** Delays a fast-changing value (a search box) so the server is asked once the person pauses typing. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
