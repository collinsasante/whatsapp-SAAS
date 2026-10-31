'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard, Building2, Users, Layers, CreditCard, BarChart3, Sparkles, Gauge, Wallet, ReceiptText, Tag, Package,
  ShoppingCart, CircleDollarSign, Landmark, MessageSquare, Phone, HeartPulse, ListOrdered, Bug, Webhook, ScrollText,
  ToggleRight, ShieldCheck, LogOut, Menu, X, Sun, Moon, ChevronDown, Loader2,
} from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { GlobalSearch } from '@/components/admin/GlobalSearch';
import { AdminProvider, useAdmin, ROLE_LABEL, type EnvironmentName } from '@/components/admin/AdminProvider';
import { ErrorState } from '@/components/admin/States';
import { cn } from '@/lib/utils';

interface NavItem { href: string; label: string; icon: React.ElementType }
interface NavSection { label: string; items: NavItem[] }

const P = '/platform-admin';
const NAV: NavSection[] = [
  { label: 'Overview', items: [{ href: `${P}/dashboard`, label: 'Platform overview', icon: LayoutDashboard }] },
  {
    label: 'Business', items: [
      { href: `${P}/workspaces`, label: 'Tenants', icon: Building2 },
      { href: `${P}/users`, label: 'Users', icon: Users },
      { href: `${P}/plans`, label: 'Subscriptions and plans', icon: Layers },
      { href: `${P}/billing`, label: 'Payments', icon: CreditCard },
      { href: `${P}/insights`, label: 'Funnel and usage', icon: BarChart3 },
    ],
  },
  {
    label: 'Verz AI', items: [
      { href: `${P}/ai`, label: 'AI overview', icon: Sparkles },
      { href: `${P}/ai/usage`, label: 'Usage by tenant', icon: Gauge },
      { href: `${P}/ai/wallets`, label: 'Credit wallets', icon: Wallet },
      { href: `${P}/ai/transactions`, label: 'Credit transactions', icon: ReceiptText },
      { href: `${P}/ai/pricing`, label: 'AI pricing', icon: Tag },
      { href: `${P}/ai/packages`, label: 'Credit packages', icon: Package },
    ],
  },
  {
    label: 'Commerce', items: [
      { href: `${P}/orders`, label: 'Orders', icon: ShoppingCart },
      { href: `${P}/commerce`, label: 'Commerce revenue', icon: CircleDollarSign },
      { href: `${P}/commerce/fees`, label: 'Fee ledger', icon: Landmark },
    ],
  },
  {
    label: 'Channels', items: [
      { href: `${P}/messaging`, label: 'Messages and delivery', icon: MessageSquare },
      { href: `${P}/messaging/whatsapp`, label: 'WhatsApp numbers', icon: Phone },
    ],
  },
  {
    label: 'Operations', items: [
      { href: `${P}/health`, label: 'System health', icon: HeartPulse },
      { href: `${P}/health/queues`, label: 'Queues', icon: ListOrdered },
      { href: `${P}/errors`, label: 'Errors', icon: Bug },
      { href: `${P}/webhooks`, label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    label: 'Governance', items: [
      { href: `${P}/audit-logs`, label: 'Audit log', icon: ScrollText },
      { href: `${P}/feature-flags`, label: 'Feature flags', icon: ToggleRight },
      { href: `${P}/admins`, label: 'Admin users', icon: ShieldCheck },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((s) => s.items);

/** The nav item that owns this path: the longest matching address, so "/ai" is not lit up on "/ai/usage". */
function activeHref(pathname: string): string | null {
  const matches = ALL_ITEMS.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

const ENV_STYLE: Record<EnvironmentName, string> = {
  Production: 'bg-red-50 text-red-800 ring-red-600/25',
  Staging: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  Local: 'bg-gray-100 text-gray-700 ring-gray-500/25',
};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="w-9 h-9" />;
  const dark = theme === 'dark';
  return (
    <button
      onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-9 h-9 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
    >
      {dark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
    </button>
  );
}

function AdminMenu({ onSignOut }: { onSignOut: () => void }) {
  const { admin } = useAdmin();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const away = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);
  if (!admin) return null;
  const initials = admin.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <span className="w-7 h-7 rounded-full bg-teal-700 text-white text-xs font-semibold flex items-center justify-center" aria-hidden="true">{initials}</span>
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-xs font-medium text-gray-900">{admin.name}</span>
          <span className="block text-[11px] text-gray-500">{ROLE_LABEL[admin.role]}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-40 py-1">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900">{admin.name}</p>
            <p className="text-xs text-gray-500 break-all">{admin.email}</p>
            <p className="text-xs text-gray-500 mt-1">{ROLE_LABEL[admin.role]}{admin.lastLoginAt ? ` · last sign-in ${new Date(admin.lastLoginAt).toLocaleString()}` : ''}</p>
          </div>
          <button role="menuitem" onClick={onSignOut} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <LogOut className="w-4 h-4" aria-hidden="true" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const current = useMemo(() => activeHref(pathname), [pathname]);
  return (
    <nav aria-label="Platform administration" className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
      {NAV.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1 text-[11px] font-medium text-green-200/50">{section.label}</p>
          <ul className="space-y-px">
            {section.items.map((item) => {
              const active = current === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md text-[13px] border-l-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300',
                      active ? 'bg-white/10 text-white border-green-400 font-medium' : 'text-gray-300 border-transparent hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <item.icon className={cn('w-4 h-4 shrink-0', active ? 'text-green-300' : 'text-gray-400 group-hover:text-gray-200')} aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
      <span className="w-7 h-7 rounded-md bg-green-500/90 flex items-center justify-center" aria-hidden="true"><ShieldCheck className="w-4 h-4 text-green-950" /></span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">VerzChat</span>
        <span className="block text-[11px] text-green-200/60">Platform console</span>
      </span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { status, environment } = useAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) { router.replace('/platform-admin/login'); return; }
    setTokenChecked(true);
  }, [router]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [mobileOpen]);

  const signOut = () => { localStorage.removeItem('admin_token'); router.push('/platform-admin/login'); };

  if (!tokenChecked || status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50" role="status" aria-label="Checking your session"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-gray-200 rounded-lg max-w-md w-full">
          <ErrorState message="The console could not confirm your session. The server may be unreachable, or your session may have ended." onRetry={() => window.location.reload()} />
          <p className="text-center text-sm pb-5"><button onClick={signOut} className="text-teal-700 hover:underline">Sign in again</button></p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <ConfirmModal />
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:top-2 focus:left-2 focus:bg-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow focus:text-sm">Skip to content</a>

      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[#0d1914]">
        <Brand />
        <SidebarNav pathname={pathname} />
      </aside>

      {/* Only in the page while open: a closed drawer that stays mounted keeps its links in the keyboard order. */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-[#0d1914] md:hidden">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" autoFocus className="text-gray-300 hover:text-white p-2"><X className="w-5 h-5" /></button>
            </div>
            <SidebarNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 shrink-0 bg-white border-b border-gray-200 flex items-center gap-2 px-3 sm:px-4">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="md:hidden p-2 -ml-1 text-gray-600 hover:text-gray-900"><Menu className="w-5 h-5" /></button>
          <div className="flex-1 min-w-0"><GlobalSearch /></div>
          <span className={cn('hidden sm:inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', ENV_STYLE[environment])} title="The deployment this console is connected to">
            {environment}
          </span>
          <ThemeToggle />
          <AdminMenu onSignOut={signOut} />
        </div>
        <main id="admin-main" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
          <div className="max-w-[1400px] mx-auto p-4 sm:p-6">
            <Suspense fallback={<div role="status" aria-label="Loading page" className="py-16 flex justify-center"><Loader2 className="w-5 h-5 text-teal-600 animate-spin" /></div>}>{children}</Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

const BARE_PAGES = ['/platform-admin/login', '/platform-admin/reset-password'];

export default function PlatformAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  if (BARE_PAGES.includes(pathname)) return <>{children}</>;
  return (
    <AdminProvider>
      <Shell>{children}</Shell>
    </AdminProvider>
  );
}
