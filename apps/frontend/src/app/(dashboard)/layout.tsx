'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { silentRefresh } from '@/lib/api';
import Sidebar from '@/components/shared/Sidebar';
import { SocketProvider } from '@/components/shared/SocketProvider';
import NotificationBell from '@/components/shared/NotificationBell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated, accessToken, setAccessToken, clearAuth, user, tenant, setAuth } = useAuthStore();
  const [restoring, setRestoring] = useState(false);

  const restoreSession = useCallback(async () => {
    // Already have a valid access token in memory — nothing to do
    if (accessToken) return;

    setRestoring(true);
    try {
      // Try to get a new access token using the HttpOnly refresh cookie.
      // The cookie is sent automatically (withCredentials: true on the axios client).
      const newToken = await silentRefresh();
      setAccessToken(newToken);
    } catch {
      // No valid cookie — session is truly expired, redirect to login
      clearAuth();
      router.replace('/login');
    } finally {
      setRestoring(false);
    }
  }, [accessToken, setAccessToken, clearAuth, router]);

  // Run session restoration after Zustand has hydrated from localStorage
  useEffect(() => {
    if (!_hasHydrated) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (!accessToken) {
      void restoreSession();
      return;
    }

    // Gate: new users who haven't completed onboarding
    if (tenant?.onboardingCompleted === false) {
      router.replace('/onboarding');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, restoreSession, router, tenant]);

  // Listen for session expiry events dispatched by the API interceptor
  useEffect(() => {
    const handler = () => {
      clearAuth();
      router.replace('/login');
    };
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [clearAuth, router]);

  // Listen for token refresh events from the API interceptor
  useEffect(() => {
    const handler = (e: Event) => {
      const token = (e as CustomEvent<{ accessToken: string }>).detail.accessToken;
      setAccessToken(token);
    };
    window.addEventListener('auth:token-refreshed', handler);
    return () => window.removeEventListener('auth:token-refreshed', handler);
  }, [setAccessToken]);

  // Show spinner while Zustand is hydrating or while silently restoring
  if (!_hasHydrated || restoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  // After hydration: if not authenticated and not currently restoring, show spinner
  // while the redirect fires (avoids flash of dashboard content)
  if (!isAuthenticated || (!accessToken && !restoring)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  return (
    <SocketProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar with notification bell */}
          <header className="h-12 flex items-center justify-end px-4 bg-white border-b border-gray-100 flex-shrink-0 gap-2">
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </SocketProvider>
  );
}
