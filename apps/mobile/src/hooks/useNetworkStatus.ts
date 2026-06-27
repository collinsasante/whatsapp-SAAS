import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { apiClient } from '../lib/api';

export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      await apiClient.http.get('/health', { timeout: 8000 });
      setIsOnline(true);
    } catch (err: unknown) {
      const hasResponse = !!(err as { response?: unknown })?.response;
      if (!hasResponse) setIsOnline(false);
      else setIsOnline(true);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && appState.current !== 'active') {
        void check();
      }
      appState.current = next;
    });
    const interval = setInterval(() => void check(), 30000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [check]);

  return isOnline;
}
