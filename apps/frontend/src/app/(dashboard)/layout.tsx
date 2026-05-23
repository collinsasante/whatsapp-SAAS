'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { canAccess } from '@/lib/permissions';
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
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
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
  const pathname = usePathname();
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
    // Already have a valid access token in Zustand memory — nothing to do
    if (accessToken) return;

    // Token survives in localStorage across refreshes — restore it into Zustand
    // without hitting the network. The 401 interceptor will handle expiry lazily.
    const stored = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (stored) {
      setAccessToken(stored);
      return;
    }

    // No token anywhere — try silent refresh via the HttpOnly cookie
    setRestoring(true);
    try {
      const newToken = await silentRefresh();
      setAccessToken(newToken);
    } catch {
      clearAuth();
      router.replace('/login?_r=restore-fail');
    } finally {
      setRestoring(false);
    }
  }, [accessToken, setAccessToken, clearAuth, router]);

  // Run session restoration after Zustand has hydrated from localStorage
  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated) {
      router.replace('/login?_r=no-auth');
      return;
    }

    if (!accessToken) {
      void restoreSession();
      return;
    }

    // Gate: new users who haven't completed onboarding
    if (tenant?.onboardingCompleted === false) {
      router.replace('/onboarding');
      return;
    }

    // Gate: role-based access — redirect to inbox if the user can't access this route
    if (user?.role && !canAccess(user.role, pathname)) {
      router.replace('/inbox');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, restoreSession, router, tenant, user, pathname]);

  // Listen for session expiry events dispatched by the API interceptor
  useEffect(() => {
    const handler = () => {
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

  // Workspace name for mobile header
  const workspaceName = tenant?.name ?? 'VerzChat';
  const workspaceInitial = workspaceName[0]?.toUpperCase() ?? 'V';

  return (
    <SocketProvider>
      <SyncProvider />
      <WhatsNewModal />
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
            {/* Top bar */}
            <header className="h-12 flex items-center justify-between px-4 bg-white border-b border-gray-100 flex-shrink-0 gap-2">
              {/* Mobile: workspace identity */}
              <div className="flex items-center gap-2.5 md:hidden">
                <div className="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {workspaceInitial}
                </div>
                <span className="text-sm font-semibold text-gray-900 truncate max-w-[160px]">
                  {workspaceName}
                </span>
              </div>
              {/* Desktop spacer */}
              <div className="hidden md:block" />
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
