'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, BarChart3, ClipboardList,
  Settings, LogOut, Radio, Globe, ShieldAlert,
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
  { href: '/platform-admin/audit',      icon: ClipboardList,   label: 'Audit Logs'  },
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

  return (
    <aside className="w-56 bg-gray-950 flex flex-col h-full flex-shrink-0">
      {/* Logo / brand */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-rose-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={14} className="text-white" />
          </div>
          <div>
            <p className="text-white text-xs font-bold leading-tight">Platform Admin</p>
            <p className="text-gray-500 text-[10px]">Super Admin Console</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, icon: Icon, label }) => {
          const isActive = href === '/platform-admin'
            ? pathname === '/platform-admin'
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900',
              )}
            >
              <Icon size={14} className="flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Admin info + logout */}
      <div className="border-t border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="w-7 h-7 bg-rose-900 rounded-full flex items-center justify-center text-rose-300 text-xs font-bold flex-shrink-0">
            {admin?.name?.slice(0, 2).toUpperCase() ?? 'SA'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{admin?.name ?? 'Admin'}</p>
            <p className="text-gray-500 text-[10px] truncate">{admin?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={() => { void handleLogout(); }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-red-400 hover:bg-gray-900 rounded-lg transition-colors"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
