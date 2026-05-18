'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, BarChart3, Settings,
  LogOut, Radio, ScrollText, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/store/admin.store';
import { adminAuthApi } from '@/lib/admin-api';

const NAV = [
  { href: '/platform-admin',           icon: LayoutDashboard, label: 'Dashboard'   },
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
    <aside className="w-60 flex flex-col h-full flex-shrink-0" style={{ backgroundColor: '#0c1117' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/30">
            <Zap size={15} className="text-white" fill="white" />
          </div>
          <div>
            <p className="text-white text-sm font-bold leading-tight tracking-tight">VerzChat</p>
            <p className="text-white/30 text-[9px] uppercase tracking-[0.12em] font-medium">Admin Console</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 overflow-y-auto">
        <p className="text-white/25 text-[9px] uppercase tracking-[0.15em] font-semibold px-3 mb-2.5">Platform</p>
        <div className="space-y-0.5">
          {NAV.map(({ href, icon: Icon, label }) => {
            const isActive = href === '/platform-admin'
              ? pathname === '/platform-admin'
              : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150',
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-400'
                    : 'text-white/45 hover:text-white/85 hover:bg-white/[0.05]',
                )}
              >
                <Icon size={14} className="flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Admin profile */}
      <div className="border-t border-white/[0.06] px-3 py-3">
        <div className="group flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.05] transition-all cursor-default">
          <div className="w-7 h-7 rounded-full border border-indigo-500/50 bg-indigo-500/15 flex items-center justify-center text-indigo-400 text-[10px] font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/80 text-xs font-semibold truncate">{admin?.name ?? 'Admin'}</p>
            <p className="text-white/30 text-[10px] truncate">{admin?.email ?? ''}</p>
          </div>
          <button
            onClick={() => { void handleLogout(); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded transition-all flex-shrink-0"
            title="Sign out"
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}
