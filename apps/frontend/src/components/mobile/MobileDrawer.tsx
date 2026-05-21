'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  X, LayoutDashboard, MessageSquare, Megaphone, FileText, Zap, Bot,
  Globe, Settings, CreditCard, Images, Wrench, LogOut, BarChart3, Phone,
  Users, Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';

const DRAWER_WIDTH = 280;

const DRAWER_SECTIONS: { title: string; items: { href: string; icon: React.ElementType; label: string }[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    title: 'Communicate',
    items: [
      { href: '/inbox',    icon: MessageSquare, label: 'Inbox' },
      { href: '/contacts', icon: Users,         label: 'Contacts' },
      { href: '/calls',    icon: Phone,         label: 'Calls' },
    ],
  },
  {
    title: 'Broadcasts',
    items: [
      { href: '/campaigns',  icon: Megaphone, label: 'Campaigns' },
      { href: '/templates',  icon: FileText,  label: 'Templates' },
      { href: '/automation', icon: Zap,       label: 'Automation' },
      { href: '/chatbot',    icon: Bot,       label: 'Chatbot Flows' },
      { href: '/ai',         icon: Brain,     label: 'Verz AI' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { href: '/settings', icon: Settings,   label: 'Account & API' },
      { href: '/channels', icon: Globe,      label: 'Channels' },
      { href: '/library',  icon: Images,     label: 'Media Library' },
      { href: '/manage',   icon: Wrench,     label: 'Manage' },
      { href: '/billing',  icon: CreditCard, label: 'Billing' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
];

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const deltaXRef = useRef(0);

  const pathname = usePathname();
  const router = useRouter();
  const { user, tenant, clearAuth } = useAuthStore();

  const workspaceName = tenant?.name ?? 'Workspace';
  const avatarLetter = workspaceName[0]?.toUpperCase() ?? 'W';

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setTranslateX(0);
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on route change
  useEffect(() => {
    if (open) onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (x: number) => {
    startXRef.current = x;
    setIsDragging(true);
  };
  const moveDrag = (x: number) => {
    if (!isDragging) return;
    const d = Math.min(0, x - startXRef.current);
    deltaXRef.current = d;
    setTranslateX(d);
  };
  const endDrag = () => {
    setIsDragging(false);
    if (deltaXRef.current < -60) {
      onClose();
    } else {
      setTranslateX(0);
    }
    deltaXRef.current = 0;
  };

  const handleLogout = async () => {
    onClose();
    try { await authApi.logout(); } finally {
      disconnectSocket();
      clearAuth();
      router.push('/login');
    }
  };

  if (!mounted) return null;

  const slideX = open ? translateX : -DRAWER_WIDTH;

  return createPortal(
    <div className={cn('fixed inset-0 z-50', !open && 'pointer-events-none')}>
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        style={{
          transform: `translateX(${slideX}px)`,
          width: `${DRAWER_WIDTH}px`,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          transition: isDragging ? 'none' : 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        className="absolute left-0 top-0 bottom-0 bg-white flex flex-col shadow-2xl"
        onTouchStart={(e) => startDrag(e.touches[0].clientX)}
        onTouchMove={(e) => { e.stopPropagation(); moveDrag(e.touches[0].clientX); }}
        onTouchEnd={endDrag}
      >
        {/* Workspace header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white text-base font-bold flex-shrink-0 shadow-sm">
            {avatarLetter}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate leading-tight">{workspaceName}</p>
            <p className="text-xs text-gray-400 truncate mt-0.5">{user?.email ?? ''}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors flex-shrink-0 active:scale-90"
          >
            <X size={14} />
          </button>
        </div>

        {/* Nav sections */}
        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {DRAWER_SECTIONS.map((section, si) => (
            <div key={si} className={cn('mb-0', si > 0 && 'mt-1 pt-1 border-t border-gray-100')}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-5 py-2 leading-none">
                {section.title}
              </p>
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3 transition-colors',
                      isActive
                        ? 'bg-teal-50 text-teal-700'
                        : 'text-gray-700 active:bg-gray-50',
                    )}
                  >
                    <Icon
                      size={18}
                      strokeWidth={isActive ? 2.2 : 1.8}
                      className={cn('flex-shrink-0', isActive ? 'text-teal-600' : 'text-gray-400')}
                    />
                    <span className={cn('text-sm leading-none', isActive ? 'font-semibold' : 'font-medium')}>
                      {item.label}
                    </span>
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Logout */}
        <div
          className="border-t border-gray-100 p-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
        >
          <button
            onClick={() => { void handleLogout(); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 active:bg-red-100 rounded-xl transition-colors"
          >
            <LogOut size={18} className="flex-shrink-0" />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
