'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Building2, CreditCard, LogOut, Settings, Shield, ChevronRight } from 'lucide-react';

const NAV = [
  { href: '/platform-admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/platform-admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/platform-admin/billing', label: 'Billing', icon: CreditCard },
  { href: '/platform-admin/plans', label: 'Plans', icon: Settings },
];

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname === '/platform-admin/login') { setReady(true); return; }
    const token = localStorage.getItem('admin_token');
    if (!token) { router.replace('/platform-admin/login'); return; }
    setReady(true);
  }, [pathname, router]);

  const logout = () => {
    localStorage.removeItem('admin_token');
    router.push('/platform-admin/login');
  };

  if (!ready) return null;
  if (pathname === '/platform-admin/login') return <>{children}</>;

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-700">
          <Shield className="w-5 h-5 text-teal-400" />
          <span className="font-semibold text-sm tracking-wide">Platform Admin</span>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-teal-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {active && <ChevronRight className="w-3 h-3 ml-auto" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 py-4 border-t border-gray-700">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
