'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminStore } from '@/store/admin.store';
import AdminSidebar from '@/components/platform-admin/AdminSidebar';

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, _hasHydrated } = useAdminStore();

  const isLoginPage = pathname === '/platform-admin/login';

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated && !isLoginPage) {
      router.replace('/platform-admin/login');
    }
    if (isAuthenticated && isLoginPage) {
      router.replace('/platform-admin');
    }
  }, [_hasHydrated, isAuthenticated, isLoginPage, router]);

  if (!_hasHydrated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isLoginPage) return <>{children}</>;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 overflow-hidden">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
