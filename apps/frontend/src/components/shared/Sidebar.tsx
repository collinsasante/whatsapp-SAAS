'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessageSquare, Users, Megaphone, FileText, Zap, Settings, LogOut,
  BarChart3, Phone, Globe, LayoutDashboard, Images, Bot, Wrench, CreditCard,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
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
    <aside className="w-16 bg-white border-r border-gray-100 flex flex-col h-full items-center py-5 flex-shrink-0">
      {/* Logo */}
      <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center mb-8 flex-shrink-0">
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        </svg>
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
  );
}
