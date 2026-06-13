'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquareDot } from 'lucide-react';
import { cn, formatMessageTime, getInitials } from '@/lib/utils';
import { useInboxStore, Conversation } from '@/store/inbox.store';
import { conversationsApi } from '@/lib/api';

const TWENTY_FOUR_HOURS = 24 * 3600 * 1000;

function isUnreplied(c: Conversation): boolean {
  if (c.status === 'RESOLVED') return false;
  if (c.lastInboundAt) {
    if (Date.now() - new Date(c.lastInboundAt).getTime() > TWENTY_FOUR_HOURS) return false;
  }
  return c.messages?.[0]?.direction === 'INBOUND';
}

export default function UnrepliedChatsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<Conversation[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const storeConversations = useInboxStore((s) => s.conversations);

  // Use store data if populated, otherwise use fetched
  const source = storeConversations.length > 0 ? storeConversations : fetched;
  const unreplied = source.filter(isUnreplied);

  // Fetch once on mount if store is empty
  useEffect(() => {
    if (storeConversations.length > 0) return;
    conversationsApi
      .list({ limit: 200 })
      .then((res) => {
        const data = (res.data as { data: Conversation[] }).data ?? [];
        setFetched(data);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const goToChat = (id: string) => {
    setOpen(false);
    router.push(`/inbox?c=${id}`);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Unreplied chats"
        className={cn(
          'relative w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
          open ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50',
        )}
      >
        <MessageSquareDot size={18} />
        {unreplied.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {unreplied.length > 99 ? '99+' : unreplied.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Unreplied Chats</span>
            {unreplied.length > 0 && (
              <span className="text-xs text-gray-400">{unreplied.length} waiting</span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {unreplied.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                All chats replied ✓
              </div>
            ) : (
              unreplied.map((c) => {
                const name = c.contact?.name ?? c.contact?.phone ?? 'Unknown';
                const lastMsg = c.messages?.[0];
                const initials = getInitials(name);
                return (
                  <button
                    key={c.id}
                    onClick={() => goToChat(c.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
                  >
                    <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {c.contact?.avatarUrl
                        ? <img src={c.contact.avatarUrl} alt={name} className="w-9 h-9 rounded-full object-cover" />
                        : initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
                        {c.lastMessageAt && (
                          <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">
                            {formatMessageTime(c.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {lastMsg?.content ?? (lastMsg?.type === 'IMAGE' ? '📷 Photo' : lastMsg?.type === 'AUDIO' ? '🎵 Audio' : lastMsg?.type === 'VIDEO' ? '🎥 Video' : lastMsg?.type === 'DOCUMENT' ? '📄 Document' : 'New message')}
                      </p>
                      {c.assignedTo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">→ {c.assignedTo.name}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
