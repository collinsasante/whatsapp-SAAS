'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { silentRefresh } from '@/lib/api';
import Sidebar, { MobileBottomNav } from '@/components/shared/Sidebar';
import { SocketProvider } from '@/components/shared/SocketProvider';
import NotificationBell from '@/components/shared/NotificationBell';
import { IncomingCallModal } from '@/components/shared/IncomingCallModal';
import { OutboundDialModal } from '@/components/shared/OutboundDialModal';
import { OutboundCallBar } from '@/components/shared/OutboundCallBar';
import { ConfirmCallModal } from '@/components/shared/ConfirmCallModal';
import OfflineBanner from '@/components/OfflineBanner';
import { SyncProvider } from '@/components/shared/SyncProvider';
import { ShieldAlert, LogOut } from 'lucide-react';

interface ImpersonationState {
  workspaceId: string;
  workspaceName: string;
  adminName: string;
}

function ImpersonationBanner({ state, onExit }: { state: ImpersonationState; onExit: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-amber-500 text-amber-950 text-sm font-medium flex-shrink-0 z-50">
      <div className="flex items-center gap-2">
        <ShieldAlert size={15} />
        <span>Impersonating <strong>{state.workspaceName}</strong> as platform admin <strong>{state.adminName}</strong></span>
      </div>
      <button
        onClick={onExit}
        className="flex items-center gap-1.5 px-3 py-1 bg-amber-700/20 hover:bg-amber-700/40 rounded-lg transition-colors text-xs font-semibold"
      >
        <LogOut size={12} />
        Exit Impersonation
      </button>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated, accessToken, setAccessToken, clearAuth, user, tenant, setAuth } = useAuthStore();
  const [restoring, setRestoring] = useState(false);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pa_impersonating');
      if (raw) setImpersonation(JSON.parse(raw) as ImpersonationState);
    } catch { /* ignore */ }
  }, []);

  const exitImpersonation = useCallback(() => {
    const returnTo = localStorage.getItem('pa_returning_to') ?? '/platform-admin/workspaces';
    localStorage.removeItem('pa_impersonating');
    localStorage.removeItem('pa_returning_to');
    clearAuth();
    window.location.href = returnTo;
  }, [clearAuth]);

  const restoreSession = useCallback(async () => {
    // Already have a valid access token in memory — nothing to do
    if (accessToken) return;

    setRestoring(true);
    console.log('[auth] no access token in memory, attempting silent refresh via cookie');
    try {
      const newToken = await silentRefresh();
      console.log('[auth] silent refresh OK');
      setAccessToken(newToken);
    } catch (err) {
      console.warn('[auth] silent refresh FAILED — logging out', err);
      clearAuth();
      router.replace('/login?_r=restore-fail');
    } finally {
      setRestoring(false);
    }
  }, [accessToken, setAccessToken, clearAuth, router]);

  // Run session restoration after Zustand has hydrated from localStorage
  useEffect(() => {
    if (!_hasHydrated) return;
    console.log('[auth] layout effect:', { isAuthenticated, hasToken: !!accessToken, onboarding: tenant?.onboardingCompleted });

    if (!isAuthenticated) {
      console.warn('[auth] not authenticated → /login');
      router.replace('/login?_r=no-auth');
      return;
    }

    if (!accessToken) {
      void restoreSession();
      return;
    }

    // Gate: new users who haven't completed onboarding
    if (tenant?.onboardingCompleted === false) {
      console.log('[auth] onboarding incomplete → /onboarding');
      router.replace('/onboarding');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, restoreSession, router, tenant]);

  // Listen for session expiry events dispatched by the API interceptor
  useEffect(() => {
    const handler = () => {
      console.warn('[auth] session-expired event fired → /login');
      clearAuth();
      router.replace('/login?_r=session-exp');
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
      <SyncProvider />
      <IncomingCallModal />
      <OutboundDialModal />
      <OutboundCallBar />
      <ConfirmCallModal />
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
        {impersonation && <ImpersonationBanner state={impersonation} onExit={exitImpersonation} />}
        <OfflineBanner />
        <div className="flex flex-1 overflow-hidden min-h-0">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Top bar with notification bell */}
            <header className="h-12 flex items-center justify-end px-4 bg-white border-b border-gray-100 flex-shrink-0 gap-2">
              <NotificationBell />
            </header>
            <main className="flex-1 overflow-hidden min-h-0">{children}</main>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    </SocketProvider>
  );
}
