'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { canAccess } from '@/lib/permissions';
import { silentRefresh } from '@/lib/api';
import Sidebar, { MobileBottomNav } from '@/components/shared/Sidebar';
import { SocketProvider } from '@/components/shared/SocketProvider';
import NotificationBell from '@/components/shared/NotificationBell';
import UnrepliedChatsStrip from '@/components/shared/UnrepliedChatsButton';
import { IncomingCallModal } from '@/components/shared/IncomingCallModal';
import { OutboundDialModal } from '@/components/shared/OutboundDialModal';
import { OutboundCallBar } from '@/components/shared/OutboundCallBar';
import { ConfirmCallModal } from '@/components/shared/ConfirmCallModal';
import OfflineBanner from '@/components/OfflineBanner';
import { SyncProvider } from '@/components/shared/SyncProvider';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ErrorTracker } from '@/components/shared/ErrorTracker';

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
  </div>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spinner />}>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </Suspense>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { isAuthenticated, _hasHydrated, accessToken, setAccessToken, clearAuth, user, tenant } = useAuthStore();
  const [restoring, setRestoring] = useState(false);

  // On mobile, an open inbox chat should take the full screen like WhatsApp —
  // hide the app chrome (top header + bottom tab bar) instead of squeezing the chat into it.
  const isMobileChatOpen = pathname?.startsWith('/inbox') && !!searchParams?.get('c');

  const restoreSession = useCallback(async () => {
    if (accessToken) return;

    const stored = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (stored) {
      setAccessToken(stored);
      return;
    }

    // Don't log out users who are simply offline — they can still use cached data.
    // Retry silently once they reconnect (the 'online' listener below handles that).
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    setRestoring(true);
    try {
      const newToken = await silentRefresh();
      setAccessToken(newToken);
    } catch {
      // Only clear session for definitive auth failures, not network errors.
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      clearAuth();
      router.replace('/login?_r=restore-fail');
    } finally {
      setRestoring(false);
    }
  }, [accessToken, setAccessToken, clearAuth, router]);

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

    if (tenant?.onboardingCompleted === false) {
      router.replace('/onboarding');
      return;
    }

    if (user?.role && pathname && !canAccess(user.role, pathname)) {
      router.replace('/inbox');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, restoreSession, router, tenant, user, pathname]);

  // When the network comes back, retry session restore in case it was skipped while offline.
  useEffect(() => {
    const handler = () => { void restoreSession(); };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, [restoreSession]);

  useEffect(() => {
    const handler = () => {
      clearAuth();
      router.replace('/login?_r=session-exp');
    };
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [clearAuth, router]);

  useEffect(() => {
    const handler = (e: Event) => {
      const token = (e as CustomEvent<{ accessToken: string }>).detail.accessToken;
      setAccessToken(token);
    };
    window.addEventListener('auth:token-refreshed', handler);
    return () => window.removeEventListener('auth:token-refreshed', handler);
  }, [setAccessToken]);

  if (!_hasHydrated || restoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!isAuthenticated || (!accessToken && !restoring)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  const workspaceName = tenant?.name ?? 'VerzChat';
  const workspaceInitial = workspaceName[0]?.toUpperCase() ?? 'V';

  return (
    <SocketProvider>
      <ErrorTracker />
      <SyncProvider />
      <WhatsNewModal />
      <IncomingCallModal />
      <OutboundDialModal />
      <OutboundCallBar />
      <ConfirmCallModal />
      <ConfirmModal />
      <div className="flex flex-col h-dvh overflow-hidden bg-gray-50">
        <OfflineBanner />
        <div className="flex flex-1 overflow-hidden min-h-0">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <header className={cn(
              'h-12 items-center justify-between px-4 bg-white border-b border-gray-100 flex-shrink-0 gap-2',
              isMobileChatOpen ? 'hidden md:flex' : 'flex',
            )}>
              {!pathname?.startsWith('/inbox') && (
                <div className="flex items-center gap-2.5 md:hidden">
                  <div className="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {workspaceInitial}
                  </div>
                  <span className="text-sm font-semibold text-gray-900 truncate max-w-[160px]">
                    {workspaceName}
                  </span>
                </div>
              )}
              {pathname?.startsWith('/inbox') && <UnrepliedChatsStrip />}
              <div className="ml-auto flex-shrink-0">
                <NotificationBell />
              </div>
            </header>
            <main className={cn(
              'flex-1 overflow-hidden min-h-0',
              !isMobileChatOpen && 'pb-[calc(56px+env(safe-area-inset-bottom,0px))] md:pb-0',
            )}>{children}</main>
          </div>
        </div>
        <MobileBottomNav hidden={isMobileChatOpen} />
      </div>
    </SocketProvider>
  );
}
