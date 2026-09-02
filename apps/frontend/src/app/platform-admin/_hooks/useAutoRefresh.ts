'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const INTERVAL_MS = 30_000;

export function useAutoRefresh(load: () => Promise<void> | void) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    await loadRef.current();
    setLastUpdated(new Date());
    setSecondsAgo(0);
  }, []);

  // Reload whenever the caller's `load` function identity changes -- that happens
  // whenever any of ITS OWN dependencies change (search/filter/sort/page, etc).
  // Previously this depended on `refresh`, which is a stable useCallback([]) wrapper
  // that never changes identity, so this effect only ever fired once on mount.
  // Changing a filter/search/sort/page updated the relevant state and re-rendered,
  // but never actually re-fetched -- the table just sat there showing stale data
  // until the next 30s auto-poll tick or a manual refresh click papered over it.
  useEffect(() => { void refresh(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll every 30 s
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Tick the "X s ago" counter every second
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(s => s + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  return { lastUpdated, secondsAgo, refresh };
}
