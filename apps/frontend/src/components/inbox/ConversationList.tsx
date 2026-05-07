'use client';
import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { cn, formatMessageTime, getInitials, truncate } from '@/lib/utils';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  messages?: Array<{ content: string | null; type: string }>;
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

const STATUS_FILTERS = ['All', 'Open', 'Pending', 'Resolved'];

export default function ConversationList({ conversations, activeId, onSelect, loading }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = conversations.filter((c) => {
    const name = c.contact.name ?? c.contact.phone;
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || c.contact.phone.includes(search);
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-80 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Inbox</h2>
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-full transition-colors',
                statusFilter === f
                  ? 'bg-green-100 text-green-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            No conversations found
          </div>
        ) : (
          filtered.map((conv) => {
            const name = conv.contact.name ?? conv.contact.phone;
            const lastMsg = conv.messages?.[0];
            const isActive = conv.id === activeId;

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'w-full flex items-center gap-3 p-4 hover:bg-gray-50 border-b border-gray-50 transition-colors text-left',
                  isActive && 'bg-green-50 border-l-2 border-l-green-500',
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-sm font-semibold">
                    {getInitials(name)}
                  </div>
                  {conv.status === 'OPEN' && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                        {formatMessageTime(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 truncate">
                      {lastMsg?.content ? truncate(lastMsg.content, 40) : lastMsg?.type ?? 'No messages yet'}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="ml-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 flex-shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
