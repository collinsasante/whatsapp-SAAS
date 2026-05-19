'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessageSquare, LayoutDashboard, Building2, Users,
  BarChart2, ScrollText, Settings, LogOut, ShieldAlert,
} from 'lucide-react';
import { useAdminStore } from '@/store/admin.store';
import { adminAuthApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

const NAV = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/users', label: 'Members', icon: Users },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { admin, isAuthenticated, _hasHydrated, clearAuth } = useAdminStore();
  const didRedirect = useRef(false);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated && !pathname.startsWith('/admin/login') && !didRedirect.current) {
      didRedirect.current = true;
      router.replace('/admin/login');
    }
  }, [_hasHydrated, isAuthenticated, pathname, router]);

  if (pathname.startsWith('/admin/login')) return <>{children}</>;

  if (!_hasHydrated || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#25D366] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  async function handleLogout() {
    try {
      await adminAuthApi.logout();
    } catch {
      // ignore
    }
    clearAuth();
    router.replace('/admin/login');
    toast.success('Signed out');
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-slate-800/60">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800/60">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#25D366] flex items-center justify-center">
              <MessageSquare size={13} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-white font-bold text-[14px]">VerzChat</span>
          </Link>
          <div className="flex items-center gap-1.5 mt-1 ml-0.5">
            <ShieldAlert size={10} className="text-amber-400" />
            <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">Control panel</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/admin/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                <Icon size={15} className={active ? 'text-[#25D366]' : ''} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-slate-800/60">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-medium text-white truncate">{admin?.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{admin?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-slate-950">
        {children}
      </main>
    </div>
  );
}
