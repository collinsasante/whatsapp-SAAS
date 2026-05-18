'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, BarChart3, Settings,
  LogOut, Radio, ScrollText, Zap, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/store/admin.store';
import { adminAuthApi } from '@/lib/admin-api';

const NAV = [
  { href: '/platform-admin',           icon: LayoutDashboard, label: 'Overview'    },
  { href: '/platform-admin/workspaces', icon: Building2,       label: 'Workspaces'  },
  { href: '/platform-admin/users',      icon: Users,           label: 'Users'       },
  { href: '/platform-admin/channels',   icon: Radio,           label: 'Channels'    },
  { href: '/platform-admin/analytics',  icon: BarChart3,       label: 'Analytics'   },
  { href: '/platform-admin/audit',      icon: ScrollText,      label: 'Audit Log'   },
  { href: '/platform-admin/settings',   icon: Settings,        label: 'Settings'    },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { admin, clearAuth } = useAdminStore();

  const handleLogout = async () => {
    try { await adminAuthApi.logout(); } catch { /* silent */ }
    clearAuth();
    router.push('/platform-admin/login');
  };

  const initials = admin?.name
    ? admin.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'SA';

  return (
    <aside className="w-56 flex flex-col h-full flex-shrink-0 select-none" style={{ backgroundColor: '#0a0f1a', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap size={13} className="text-white" fill="white" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-bold leading-none">VerzChat</p>
            <p className="text-white/25 text-[9px] uppercase tracking-[0.14em] font-medium mt-0.5">Admin Console</p>
          </div>
        </div>
      </div>

      <div className="mx-4 border-t border-white/[0.05] mb-3" />

      {/* Nav */}
      <nav className="flex-1 px-2 overflow-y-auto">
        <p className="text-white/20 text-[9px] uppercase tracking-[0.16em] font-bold px-2 mb-2">Platform</p>
        <div className="space-y-px">
          {NAV.map(({ href, icon: Icon, label }) => {
            const isActive = href === '/platform-admin'
              ? pathname === '/platform-admin'
              : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'group flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-all',
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-white/35 hover:text-white/70 hover:bg-white/[0.04]',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon size={13} className="flex-shrink-0" />
                  {label}
                </div>
                {isActive && <ChevronRight size={10} className="text-indigo-400/60" />}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Admin profile */}
      <div className="p-2 border-t border-white/[0.05]">
        <div className="group flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/[0.04] transition-all cursor-default">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 text-[10px] font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/75 text-[11px] font-semibold truncate leading-none">{admin?.name ?? 'Admin'}</p>
            <p className="text-white/25 text-[9px] truncate mt-0.5">{admin?.email ?? ''}</p>
          </div>
          <button
            onClick={() => { void handleLogout(); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-white/25 hover:text-red-400 rounded-md transition-all flex-shrink-0"
            title="Sign out"
          >
            <LogOut size={11} />
          </button>
        </div>
      </div>
    </aside>
  );
}
