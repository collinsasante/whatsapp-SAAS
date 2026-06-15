'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { cn, getInitials } from '@/lib/utils';
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

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function UnrepliedChatsStrip() {
  const router = useRouter();
  const pathname = usePathname();
  const [fetched, setFetched] = useState<Conversation[]>([]);
  const storeConversations = useInboxStore((s) => s.conversations);

  const source = storeConversations.length > 0 ? storeConversations : fetched;
  const unreplied = source.filter(isUnreplied);

  useEffect(() => {
    if (storeConversations.length > 0) return;
    conversationsApi.list({ limit: 200 })
      .then((res) => setFetched((res.data as { data: Conversation[] }).data ?? []))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (unreplied.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 mx-4">
      <span className="text-[10px] font-bold text-red-500 whitespace-nowrap flex-shrink-0 uppercase tracking-wide">
        {unreplied.length} Pending
      </span>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1 min-w-0">
        {unreplied.map((c) => {
          const name = c.contact?.name ?? c.contact?.phone ?? 'Unknown';
          const short = name.length > 14 ? name.slice(0, 13) + '…' : name;
          const color = avatarColor(name);
          const lastMsg = c.messages?.[0];
          const preview = lastMsg?.content
            ? (lastMsg.content.length > 20 ? lastMsg.content.slice(0, 19) + '…' : lastMsg.content)
            : lastMsg?.type === 'IMAGE' ? '📷 Photo'
            : lastMsg?.type === 'AUDIO' ? '🎵 Audio'
            : lastMsg?.type === 'VIDEO' ? '🎥 Video'
            : lastMsg?.type === 'DOCUMENT' ? '📄 Doc'
            : 'New message';

          return (
            <button
              key={c.id}
              onClick={() => {
                if (pathname?.startsWith('/inbox')) {
                  window.dispatchEvent(new CustomEvent('inbox:open-conversation', { detail: { conversationId: c.id } }));
                } else {
                  router.push(`/inbox?c=${c.id}`);
                }
              }}
              title={`${name}: ${preview}`}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200 bg-white hover:border-teal-400 hover:bg-teal-50 transition-colors flex-shrink-0 group',
              )}
            >
              <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0', color)}>
                {c.contact?.avatarUrl
                  ? <img src={c.contact.avatarUrl} alt={name} className="w-5 h-5 rounded-full object-cover" />
                  : getInitials(name).slice(0, 1)}
              </div>
              <div className="text-left leading-none">
                <p className="text-[10px] font-semibold text-gray-800 group-hover:text-teal-700 whitespace-nowrap">{short}</p>
                <p className="text-[9px] text-gray-400 whitespace-nowrap">{preview}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
