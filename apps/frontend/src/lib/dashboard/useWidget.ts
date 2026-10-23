'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiError } from '@/lib/utils';

interface State<T> {
  key: string;
  data: T | null;
  error: string | null;
  loading: boolean;
}

export interface Widget<T> {
  /** Data for the current key only: never the previous range's numbers under a new range's heading. */
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one dashboard widget independently of the others. A new key (for example a different date range) aborts the
 * request in flight and discards its answer, so a slow response for an old range can never overwrite a newer one.
 * When the key is unchanged (refresh, retry), the data on screen stays until the new data arrives.
 */
export function useWidget<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean; refreshKey?: number } = {},
): Widget<T> {
  const { enabled = true, refreshKey = 0 } = options;
  const [state, setState] = useState<State<T>>({ key, data: null, error: null, loading: enabled });
  const [retry, setRetry] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => ({ key, data: s.key === key ? s.data : null, error: null, loading: true }));
    loadRef.current(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ key, data, error: null, loading: false }); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ key, data: s.key === key ? s.data : null, error: getApiError(err, 'Please try again in a moment.'), loading: false }));
      });
    return () => controller.abort();
  }, [key, enabled, refreshKey, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    loading: !current || state.loading,
    error: current ? state.error : null,
    reload,
  };
}
