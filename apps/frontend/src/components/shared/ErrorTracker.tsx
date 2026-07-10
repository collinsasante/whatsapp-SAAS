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

    // Harmless browser quirk (Chrome/Safari) fired when a ResizeObserver callback can't
    // finish delivering all notifications within one frame — not an app bug, never actionable.
    const isIgnorable = (message: string) => /^ResizeObserver loop/.test(message);

    const onError = (event: ErrorEvent) => {
      if (isIgnorable(event.message)) return;
      report(event.message, event.error?.stack, event.filename);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object' && 'name' in err) {
        // e.g. DOMException from a failed IndexedDB request — carries useful name/code
        // but isn't `instanceof Error` in every browser, and rarely has a stack.
        const name = String((err as { name?: unknown }).name ?? 'Error');
        const code = 'code' in err ? ` code=${(err as { code?: unknown }).code}` : '';
        message = `${name}${code}: ${String((err as { message?: unknown }).message ?? err)}`;
      } else {
        message = String(err ?? 'Unhandled promise rejection');
      }
      if (isIgnorable(message)) return;
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
