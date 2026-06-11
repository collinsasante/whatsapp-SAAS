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

  // Initial load
  useEffect(() => { void refresh(); }, [refresh]);

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
