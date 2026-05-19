'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessageSquare, Users, Megaphone, FileText, Zap, Settings, LogOut,
  BarChart3, Phone, Globe, LayoutDashboard, Images, Bot, Wrench, CreditCard,
  ChevronRight, Check, Plus, Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, WorkspaceEntry } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';

type SubItem = { href: string; icon: React.ElementType; label: string };
type NavLink = { type: 'link'; href: string; icon: React.ElementType; label: string };
type NavGroup = { type: 'group'; icon: React.ElementType; label: string; children: SubItem[] };
type NavItem = NavLink | NavGroup;

const mainNav: NavItem[] = [
  { type: 'link', href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { type: 'link', href: '/inbox',     icon: MessageSquare,   label: 'Inbox' },
  { type: 'link', href: '/contacts',  icon: Users,           label: 'Contacts' },
  {
    type: 'group',
    icon: Megaphone,
    label: 'Broadcasts',
    children: [
      { href: '/campaigns',  icon: Megaphone, label: 'Campaigns' },
      { href: '/templates',  icon: FileText,  label: 'Templates' },
      { href: '/automation', icon: Zap,       label: 'Automation' },
      { href: '/chatbot',    icon: Bot,       label: 'Chatbot Flows' },
      { href: '/ai',         icon: Brain,     label: 'AI Assistant' },
    ],
  },
  { type: 'link', href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { type: 'link', href: '/calls',     icon: Phone,     label: 'Calls' },
];

const settingsGroup: NavGroup = {
  type: 'group',
  icon: Settings,
  label: 'Settings',
  children: [
    { href: '/settings', icon: Settings,  label: 'Account & API' },
    { href: '/channels', icon: Globe,     label: 'Channels' },
    { href: '/library',  icon: Images,    label: 'Media Library' },
    { href: '/manage',   icon: Wrench,    label: 'Manage' },
    { href: '/billing',  icon: CreditCard, label: 'Billing' },
  ],
};

function GroupFlyout({
  group, open, buttonRef, onClose,
}: {
  group: NavGroup;
  open: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number }>({});

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.top;
      const estimatedHeight = group.children.length * 44 + 40;
      if (spaceBelow < estimatedHeight) {
        setPos({ bottom: window.innerHeight - rect.bottom - 4 });
      } else {
        setPos({ top: Math.max(8, rect.top - 4) });
      }
    }
  }, [open, buttonRef, group.children.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, buttonRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{ ...pos, left: 68 }}
      className="fixed z-50 bg-white border border-gray-200 rounded-2xl shadow-xl py-2 min-w-[192px]"
    >
      <p className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{group.label}</p>
      {group.children.map((child) => {
        const isActive = pathname.startsWith(child.href);
        return (
          <Link
            key={child.href}
            href={child.href}
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
              isActive
                ? 'bg-teal-50 text-teal-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
            )}
          >
            <child.icon size={15} className="flex-shrink-0" />
            {child.label}
          </Link>
        );
      })}
    </div>
  );
}

function NavItemButton({ item, openGroup, setOpenGroup }: {
  item: NavItem;
  openGroup: string | null;
  setOpenGroup: (g: string | null) => void;
}) {
  const pathname = usePathname();
  const btnRef = useRef<HTMLButtonElement>(null);

  if (item.type === 'link') {
    const isActive = pathname.startsWith(item.href);
    return (
      <Link
        href={item.href}
        title={item.label}
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
          isActive
            ? 'bg-teal-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50',
        )}
      >
        <item.icon size={18} />
      </Link>
    );
  }

  const isOpen = openGroup === item.label;
  const isActive = item.children.some((c) => pathname.startsWith(c.href));

  return (
    <>
      <button
        ref={btnRef}
        title={item.label}
        onClick={() => setOpenGroup(isOpen ? null : item.label)}
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-colors relative',
          isActive || isOpen
            ? 'bg-teal-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50',
        )}
      >
        <item.icon size={18} />
        {isActive && (
          <span className="absolute -right-0.5 -top-0.5 w-2 h-2 bg-white rounded-full border-2 border-teal-600" />
        )}
      </button>
      <GroupFlyout
        group={item}
        open={isOpen}
        buttonRef={btnRef}
        onClose={() => setOpenGroup(null)}
      />
    </>
  );
}

function WorkspaceSwitcher() {
  const router = useRouter();
  const { tenant, workspaces, switchTenant, setWorkspaces } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number }>({});

  // Load workspaces once
  useEffect(() => {
    if (workspaces.length === 0) {
      void authApi.getWorkspaces().then((r) => {
        setWorkspaces(r.data as WorkspaceEntry[]);
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const estimatedHeight = (workspaces.length + 1) * 44 + 60;
      if (window.innerHeight - rect.top < estimatedHeight) {
        setPos({ bottom: window.innerHeight - rect.bottom - 4 });
      } else {
        setPos({ top: Math.max(8, rect.top - 4) });
      }
    }
  }, [open, workspaces.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) { setOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSwitch = async (ws: WorkspaceEntry) => {
    if (ws.id === tenant?.id || switching) return;
    setSwitching(ws.id);
    try {
      const res = await authApi.switchWorkspace(ws.id);
      const { accessToken } = res.data as { accessToken: string };
      switchTenant({ id: ws.id, name: ws.name, slug: ws.slug }, accessToken);
      setOpen(false);
      // Full page reload so all queries re-fetch with the new tenantId JWT
      window.location.href = '/dashboard';
    } catch {
      // stay on current workspace
    } finally {
      setSwitching(null);
    }
  };

  const initials = tenant?.name?.slice(0, 2).toUpperCase() ?? '??';

  return (
    <>
      <button
        ref={btnRef}
        title={tenant?.name ?? 'Workspace'}
        onClick={() => setOpen((o) => !o)}
        className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white text-xs font-bold hover:bg-teal-700 transition-colors flex-shrink-0"
      >
        {initials}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{ ...pos, left: 68 }}
          className="fixed z-50 bg-white border border-gray-200 rounded-2xl shadow-xl py-2 min-w-[220px]"
        >
          <p className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Workspaces</p>
          {workspaces.map((ws) => {
            const isActive = ws.id === tenant?.id;
            return (
              <button
                key={ws.id}
                onClick={() => { void handleSwitch(ws); }}
                disabled={isActive || switching === ws.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left',
                  isActive ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-gray-700 hover:bg-gray-50',
                )}
              >
                <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {ws.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{ws.name}</span>
                {isActive && <Check size={13} className="text-teal-600 flex-shrink-0" />}
                {switching === ws.id && (
                  <span className="w-3 h-3 border-2 border-teal-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </button>
            );
          })}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <Plus size={13} />
              <span>Manage team</span>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const { clearAuth } = useAuthStore();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const handleLogout = async () => {
    try { await authApi.logout(); } finally {
      disconnectSocket();
      clearAuth();
      router.push('/login');
    }
  };


  const settingsActive = settingsGroup.children.some((c) => pathname.startsWith(c.href));
  const settingsOpen = openGroup === settingsGroup.label;

  return (
    <>
    <aside className="w-16 bg-white border-r border-gray-100 flex flex-col h-full items-center py-5 flex-shrink-0">
      {/* Workspace switcher replaces static logo */}
      <div className="mb-8 flex-shrink-0">
        <WorkspaceSwitcher />
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col items-center gap-1.5">
        {mainNav.map((item) => (
          <NavItemButton
            key={item.label}
            item={item}
            openGroup={openGroup}
            setOpenGroup={setOpenGroup}
          />
        ))}
      </nav>

      {/* Settings group + logout */}
      <div className="flex flex-col items-center gap-1.5">
        {/* Settings group */}
        <button
          ref={settingsBtnRef}
          title="Settings"
          onClick={() => setOpenGroup(settingsOpen ? null : settingsGroup.label)}
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
            settingsActive || settingsOpen
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50',
          )}
        >
          <Settings size={18} />
        </button>
        <GroupFlyout
          group={settingsGroup}
          open={settingsOpen}
          buttonRef={settingsBtnRef}
          onClose={() => setOpenGroup(null)}
        />

        {/* Logout */}
        <button
          onClick={() => { void handleLogout(); }}
          title="Logout"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
        </button>
        <span className="text-[9px] text-gray-300 select-none">v1.0</span>
      </div>
    </aside>
    </>
  );
}
