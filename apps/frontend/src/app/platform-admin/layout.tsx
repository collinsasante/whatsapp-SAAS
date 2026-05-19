'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Building2, Users, BarChart3, FileText,
  Settings, LogOut, MessageSquare, ChevronRight,
} from 'lucide-react';
import { useAdminStore } from '@/store/admin.store';
import { platformAdminApi } from '@/lib/platform-admin-api';

const NAV = [
  { href: '/platform-admin/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/platform-admin/workspaces',  icon: Building2,       label: 'Workspaces' },
  { href: '/platform-admin/users',       icon: Users,           label: 'Users' },
  { href: '/platform-admin/analytics',   icon: BarChart3,       label: 'Analytics' },
  { href: '/platform-admin/audit',       icon: FileText,        label: 'Audit Log' },
  { href: '/platform-admin/settings',    icon: Settings,        label: 'Settings' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, admin, _hydrated, clearAuth } = useAdminStore();

  useEffect(() => {
    if (!_hydrated) return;
    if (!token && pathname !== '/platform-admin/login') {
      router.replace('/platform-admin/login');
    }
  }, [_hydrated, token, pathname, router]);

  // Login page renders without sidebar
  if (!token || pathname === '/platform-admin/login') {
    return <>{children}</>;
  }

  async function logout() {
    await platformAdminApi.logout();
    clearAuth();
    router.replace('/platform-admin/login');
  }

  return (
    <div className="flex h-screen bg-[#020917] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-white/6" style={{ background: '#040d1a' }}>
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-white/6">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
            <MessageSquare size={13} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-white text-sm font-bold leading-none">VerzChat</p>
            <p className="text-slate-600 text-[10px] leading-none mt-0.5">Platform Admin</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                  active
                    ? 'bg-teal-500/15 text-teal-300 border border-teal-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={16} className={active ? 'text-teal-400' : 'text-slate-500 group-hover:text-slate-300'} />
                {label}
                {active && <ChevronRight size={13} className="ml-auto text-teal-500" />}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="px-3 pb-4 border-t border-white/6 pt-3">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/4 mb-2">
            <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold flex-shrink-0">
              {admin?.name?.charAt(0).toUpperCase() ?? 'A'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-medium truncate">{admin?.name ?? 'Admin'}</p>
              <p className="text-slate-500 text-[10px] truncate">{admin?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 text-sm transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
