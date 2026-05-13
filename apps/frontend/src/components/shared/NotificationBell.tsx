'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, MessageSquare, UserPlus, Megaphone, Zap, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotificationsStore, AppNotification } from '@/store/notifications.store';
import { getSocket } from '@/lib/socket';
import { formatMessageTime } from '@/lib/utils';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  NEW_MESSAGE:              { icon: MessageSquare, color: 'text-teal-600',   bg: 'bg-teal-50' },
  CONVERSATION_ASSIGNED:    { icon: UserPlus,      color: 'text-indigo-600', bg: 'bg-indigo-50' },
  CONVERSATION_RESOLVED:    { icon: CheckCheck,    color: 'text-green-600',  bg: 'bg-green-50' },
  CAMPAIGN_COMPLETED:       { icon: Megaphone,     color: 'text-blue-600',   bg: 'bg-blue-50' },
  CAMPAIGN_FAILED:          { icon: Megaphone,     color: 'text-red-600',    bg: 'bg-red-50' },
  MENTION:                  { icon: Zap,           color: 'text-orange-600', bg: 'bg-orange-50' },
  SYSTEM:                   { icon: Info,          color: 'text-gray-600',   bg: 'bg-gray-50' },
};

function NotifItem({ notif, onRead }: { notif: AppNotification; onRead: (id: string) => void }) {
  const router = useRouter();
  const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG['SYSTEM'];
  const Icon = cfg.icon;

  const handleClick = () => {
    if (!notif.isRead) onRead(notif.id);
    if (notif.link) router.push(notif.link);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left',
        !notif.isRead && 'bg-teal-50/40',
      )}
    >
      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
        <Icon size={14} className={cfg.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-semibold text-gray-900', !notif.isRead && 'text-teal-800')}>{notif.title}</p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.body}</p>
        <p className="text-[10px] text-gray-400 mt-1">{formatMessageTime(notif.createdAt)}</p>
      </div>
      {!notif.isRead && <div className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0 mt-2" />}
    </button>
  );
}

export default function NotificationBell() {
  const { unreadCount, notifications, panelOpen, setPanelOpen, fetchUnreadCount, markRead, markAllRead, addNotification } = useNotificationsStore();
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch unread count on mount
  useEffect(() => { void fetchUnreadCount(); }, [fetchUnreadCount]);

  // Listen for realtime notifications
  useEffect(() => {
    const socket = getSocket();
    const handler = (data: AppNotification) => {
      addNotification(data);
    };
    socket.on('notification:new', handler);
    return () => { socket.off('notification:new', handler); };
  }, [addNotification]);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen, setPanelOpen]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn(
          'relative w-9 h-9 flex items-center justify-center rounded-xl transition-colors',
          panelOpen ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50',
        )}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div className="absolute right-0 top-11 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[480px]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-teal-600" />
              <span className="text-sm font-semibold text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-1.5 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => void markAllRead()}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-1 rounded-lg hover:bg-teal-50 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setPanelOpen(false)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Bell size={28} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No notifications yet</p>
                <p className="text-xs mt-1">We'll notify you when something happens</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotifItem key={n.id} notif={n} onRead={(id) => void markRead(id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
