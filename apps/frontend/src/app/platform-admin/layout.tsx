'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard, Building2, CreditCard, LogOut, Shield, ChevronRight, ChevronDown, Menu, X,
  Sparkles, ShoppingCart, MessageSquare, Activity, ShieldCheck, Sun, Moon,
} from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { GlobalSearch } from '@/components/admin/GlobalSearch';

type NavLink = { type: 'link'; href: string; label: string; icon: React.ElementType };
type NavGroup = { type: 'group'; label: string; icon: React.ElementType; children: { href: string; label: string }[] };
type NavItem = NavLink | NavGroup;

const NAV: NavItem[] = [
  { type: 'link', href: '/platform-admin/dashboard', label: 'Overview', icon: LayoutDashboard },
  {
    type: 'group', label: 'SaaS', icon: Building2,
    children: [
      { href: '/platform-admin/workspaces', label: 'Tenants' },
      { href: '/platform-admin/users', label: 'Users' },
      { href: '/platform-admin/plans', label: 'Plans & Subscriptions' },
      { href: '/platform-admin/insights', label: 'Funnel & Usage' },
    ],
  },
  {
    type: 'group', label: 'AI', icon: Sparkles,
    children: [
      { href: '/platform-admin/ai', label: 'Verz AI Overview' },
      { href: '/platform-admin/ai/usage', label: 'AI Usage' },
      { href: '/platform-admin/ai/wallets', label: 'Credit Wallets' },
      { href: '/platform-admin/ai/transactions', label: 'Credit Transactions' },
      { href: '/platform-admin/ai/pricing', label: 'AI Pricing' },
      { href: '/platform-admin/ai/packages', label: 'Credit Packages' },
    ],
  },
  {
    type: 'group', label: 'Commerce', icon: ShoppingCart,
    children: [
      { href: '/platform-admin/orders', label: 'Orders' },
      { href: '/platform-admin/commerce', label: 'Commerce Revenue' },
      { href: '/platform-admin/commerce/fees', label: 'Commerce Fee Ledger' },
    ],
  },
  { type: 'link', href: '/platform-admin/billing', label: 'Payments', icon: CreditCard },
  {
    type: 'group', label: 'Messaging', icon: MessageSquare,
    children: [
      { href: '/platform-admin/messaging', label: 'Messages & Delivery' },
      { href: '/platform-admin/messaging/whatsapp', label: 'WhatsApp Accounts' },
    ],
  },
  {
    type: 'group', label: 'Monitoring', icon: Activity,
    children: [
      { href: '/platform-admin/health', label: 'System Health' },
      { href: '/platform-admin/health/queues', label: 'Queues' },
      { href: '/platform-admin/errors', label: 'Errors' },
      { href: '/platform-admin/webhooks', label: 'Webhooks' },
    ],
  },
  {
    type: 'group', label: 'Administration', icon: ShieldCheck,
    children: [
      { href: '/platform-admin/admins', label: 'Admin Users' },
      { href: '/platform-admin/audit-logs', label: 'Audit Logs' },
      { href: '/platform-admin/feature-flags', label: 'Feature Flags' },
    ],
  },
];

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.children.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'));
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-teal-400 hover:bg-gray-700 transition-colors"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV.filter((n): n is NavGroup => n.type === 'group').map((g) => [g.label, isGroupActive(g, pathname)])),
  );

  useEffect(() => {
    if (pathname === '/platform-admin/login' || pathname === '/platform-admin/reset-password') { setReady(true); return; }
    const token = localStorage.getItem('admin_token');
    if (!token) { router.replace('/platform-admin/login'); return; }
    // Validate the token is still live (catches expiry after 12h or post-deploy invalidation)
    const base = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1') + '/platform-admin';
    fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) {
          localStorage.removeItem('admin_token');
          router.replace('/platform-admin/login');
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, [pathname, router]);

  // Close mobile nav on route change; auto-expand whichever group the new route belongs to
  useEffect(() => {
    setMobileOpen(false);
    const activeGroup = NAV.find((n): n is NavGroup => n.type === 'group' && isGroupActive(n, pathname));
    if (activeGroup) setOpenGroups((prev) => ({ ...prev, [activeGroup.label]: true }));
  }, [pathname]);

  const logout = () => {
    localStorage.removeItem('admin_token');
    router.push('/platform-admin/login');
  };

  if (!ready) return null;
  if (pathname === '/platform-admin/login' || pathname === '/platform-admin/reset-password') return <>{children}</>;

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          if (item.type === 'link') {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClick}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-teal-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
                {active && <ChevronRight className="w-3 h-3 ml-auto" />}
              </Link>
            );
          }

          const groupActive = isGroupActive(item, pathname);
          const open = openGroups[item.label] ?? groupActive;
          return (
            <div key={item.label}>
              <button
                onClick={() => setOpenGroups((prev) => ({ ...prev, [item.label]: !open }))}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                  groupActive ? 'text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
                <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="ml-4 pl-3 border-l border-gray-700 space-y-0.5 mt-0.5">
                  {item.children.map((child) => {
                    const active = pathname === child.href || pathname.startsWith(child.href + '/');
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onClick}
                        className={`block px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                          active ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="px-2 py-4 border-t border-gray-700">
        <button
          onClick={() => { onClick?.(); logout(); }}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      <ConfirmModal />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-gray-900 text-white flex-col shrink-0">
        <div className="flex items-center justify-between gap-2 px-5 py-5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-teal-400" />
            <span className="font-semibold text-sm tracking-wide">Platform Admin</span>
          </div>
          <ThemeToggle />
        </div>
        <NavLinks />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile slide-out drawer */}
      <aside className={`fixed top-0 left-0 h-full w-72 bg-gray-900 text-white flex flex-col z-50 transition-transform duration-300 md:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-teal-400" />
            <span className="font-semibold text-sm tracking-wide">Platform Admin</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <NavLinks onClick={() => setMobileOpen(false)} />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 text-white shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-gray-300 hover:text-white md:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <Shield className="w-4 h-4 text-teal-400" />
            <span className="font-semibold text-sm tracking-wide">Platform Admin</span>
          </div>
          <div className="hidden md:block flex-1 max-w-sm">
            <GlobalSearch />
          </div>
          <div className="flex-1 md:hidden" />
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
