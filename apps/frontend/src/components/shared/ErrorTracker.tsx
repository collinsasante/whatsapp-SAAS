'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

export function ErrorTracker() {
  const { user, tenant } = useAuthStore();

  useEffect(() => {
    const report = (message: string, stack?: string, sourceUrl?: string) => {
      // Fire-and-forget — never block the UI thread
      void api.post('/client-errors', {
        message,
        stack,
        url: sourceUrl ?? window.location.href,
        userAgent: navigator.userAgent,
        tenantId: tenant?.id,
        userId: user?.id,
      }).catch(() => { /* ignore — reporter must never throw */ });
    };

    const onError = (event: ErrorEvent) => {
      report(event.message, event.error?.stack, event.filename);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      const message = err instanceof Error ? err.message : String(err ?? 'Unhandled promise rejection');
      const stack = err instanceof Error ? err.stack : undefined;
      report(message, stack);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [user?.id, tenant?.id]);

  return null;
}
