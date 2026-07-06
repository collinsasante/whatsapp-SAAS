'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search, Plus, X, ChevronDown, Loader2, Users, Filter,
  MessageSquare, Phone, Mail, Tag, SlidersHorizontal,
} from 'lucide-react';
import { contactsApi, conversationsApi, tagsApi, usersApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { getSocket, SocketEvent } from '@/lib/socket';
import { cn, getInitials, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LastMessage {
  id: string;
  content: string | null;
  type: string;
  direction: string;
  createdAt: string;
  mediaCaption: string | null;
}

interface LatestConv {
  id: string;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  assignedTo: { id: string; name: string; avatarUrl: string | null } | null;
  channel: { id: string; name: string; type: string } | null;
  messages: LastMessage[];
}

interface ContactItem {
  id: string;
  name: string | null;
  phone: string;
  email?: string | null;
  labels: string[];
  customFields: Record<string, string>;
  isBlocked: boolean;
  optedOut: boolean;
  createdAt: string;
  latestConversation: LatestConv | null;
}

interface ConvPayload {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels: string[];
  channel?: { id: string; type: string; name: string };
}

// ── Avatar colors ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-emerald-100 text-emerald-700',
  'bg-yellow-100 text-yellow-700',
  'bg-red-100 text-red-700',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Channel badge ──────────────────────────────────────────────────────────────

function ChannelBadge({ type }: { type: string }) {
  if (type === 'WHATSAPP') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-green-500" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        WA
      </span>
    );
  }
  if (type === 'MESSENGER') {
    return <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Messenger</span>;
  }
  if (type === 'INSTAGRAM') {
    return <span className="text-[9px] font-semibold text-pink-700 bg-pink-50 px-1.5 py-0.5 rounded-full">IG</span>;
  }
  return null;
}

// ── Last message preview ───────────────────────────────────────────────────────

function getMessagePreview(msg: LastMessage): string {
  if (msg.content) return msg.content;
  if (msg.mediaCaption) return msg.mediaCaption;
  const icons: Record<string, string> = {
    IMAGE: '📷 Photo', VIDEO: '🎥 Video', AUDIO: '🎵 Audio',
    DOCUMENT: '📄 Document', LOCATION: '📍 Location',
    TEMPLATE: '📋 Template', STICKER: '🏷️ Sticker',
  };
  return icons[msg.type] ?? '📎 Attachment';
}

// ── Status filter config ───────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'requesting', label: 'Requesting' },
  { key: 'OPEN', label: 'Open' },
  { key: 'RESOLVED', label: 'Resolved' },
];

// ── Skeleton loader ────────────────────────────────────────────────────────────

function ContactSkeleton() {
  return (
    <div className="px-4 py-3 flex items-start gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex justify-between">
          <div className="h-3.5 bg-gray-200 rounded w-28" />
          <div className="h-3 bg-gray-200 rounded w-10" />
        </div>
        <div className="h-3 bg-gray-200 rounded w-40" />
        <div className="h-3 bg-gray-100 rounded w-20" />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  activeConversationId: string | null;
  onSelectContact: (convId: string, conv: ConvPayload) => void;
  onManage: () => void;
  onCreateContact: () => void;
}

export default function ContactWorkspaceList({
  activeConversationId,
  onSelectContact,
  onManage,
  onCreateContact,
}: Props) {
  const { conversations, prependConversation, updateConversation } = useInboxStore();

  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search]);

  // Load tags and team members once
  useEffect(() => {
    tagsApi.list().then((res) => {
      const tags = res.data as Array<{ name: string }>;
      setAvailableTags(tags.map((t) => t.name));
    }).catch(() => {});
    usersApi.list().then((res) => {
      setTeamMembers((res.data as { id: string; name: string }[]) ?? []);
    }).catch(() => {});
  }, []);

  // Load contacts whenever filters change
  const loadContacts = useCallback(async (p: number, append = false) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params: Record<string, unknown> = { page: p, limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (tagFilter) params.label = tagFilter;

      const res = await contactsApi.list(params);
      const { data, meta } = res.data as { data: ContactItem[]; meta: { total: number; totalPages: number; page: number } };

      setContacts((prev) => append ? [...prev, ...data] : data);
      setTotal(meta.total);
      setHasMore(p < meta.totalPages);
      setPage(p);
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      if (p === 1) setLoading(false); else setLoadingMore(false);
    }
  }, [debouncedSearch, tagFilter]);

  useEffect(() => { void loadContacts(1); }, [loadContacts]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      void loadContacts(page + 1, true);
    }
  }, [loadingMore, hasMore, page, loadContacts]);

  // Realtime: update last message preview when new messages arrive
  useEffect(() => {
    const socket = getSocket();
    const handleNewMessage = (data: { conversationId: string; message: LastMessage }) => {
      setContacts((prev) => prev.map((c) => {
        if (c.latestConversation?.id !== data.conversationId) return c;
        const isActive = data.conversationId === activeConversationId;
        return {
          ...c,
          latestConversation: {
            ...c.latestConversation!,
            lastMessageAt: data.message.createdAt,
            unreadCount: isActive
              ? 0
              : (c.latestConversation!.unreadCount ?? 0) + (data.message.direction === 'INBOUND' ? 1 : 0),
            messages: [data.message],
          },
        };
      }));
    };

    const handleConvUpdate = (data: Record<string, unknown>) => {
      const id = (data.conversationId ?? data.id) as string;
      if (!id) return;
      setContacts((prev) => prev.map((c) => {
        if (c.latestConversation?.id !== id) return c;
        return {
          ...c,
          latestConversation: {
            ...c.latestConversation!,
            status: (data.status as string) ?? c.latestConversation!.status,
            unreadCount: (data.unreadCount as number) ?? c.latestConversation!.unreadCount,
            lastMessageAt: (data.lastMessageAt as string) ?? c.latestConversation!.lastMessageAt,
            assignedTo: (data.assignedTo as LatestConv['assignedTo']) ?? c.latestConversation!.assignedTo,
          },
        };
      }));
    };

    socket.on(SocketEvent.NEW_MESSAGE, handleNewMessage);
    socket.on(SocketEvent.CONVERSATION_UPDATED, handleConvUpdate);
    socket.on('conversation_state_changed', handleConvUpdate);

    return () => {
      socket.off(SocketEvent.NEW_MESSAGE, handleNewMessage);
      socket.off(SocketEvent.CONVERSATION_UPDATED, handleConvUpdate);
      socket.off('conversation_state_changed', handleConvUpdate);
    };
  }, [activeConversationId]);

  // Click contact → find or create conversation → open workspace
  const handleSelect = useCallback(async (contact: ContactItem) => {
    if (openingId === contact.id) return;
    setOpeningId(contact.id);
    try {
      let conv: ConvPayload;
      const existingConvId = contact.latestConversation?.id;

      if (existingConvId) {
        // Try to find in store first (avoids an API call)
        const fromStore = conversations.find((c) => c.id === existingConvId);
        if (fromStore) {
          conv = fromStore as unknown as ConvPayload;
        } else {
          const res = await conversationsApi.findOrCreate(contact.id);
          conv = res.data as ConvPayload;
          prependConversation(conv);
        }
      } else {
        // No conversation yet — create one
        const res = await conversationsApi.findOrCreate(contact.id);
        conv = res.data as ConvPayload;
        prependConversation(conv);
        // Update local state so subsequent clicks skip the API call
        setContacts((prev) => prev.map((c) =>
          c.id === contact.id
            ? { ...c, latestConversation: { ...conv as unknown as LatestConv, messages: [] } }
            : c,
        ));
      }

      // Clear unread on select
      if (contact.latestConversation) {
        setContacts((prev) => prev.map((c) =>
          c.id === contact.id ? { ...c, latestConversation: { ...c.latestConversation!, unreadCount: 0 } } : c,
        ));
        updateConversation(conv.id, { unreadCount: 0 });
      }

      onSelectContact(conv.id, conv);
    } catch {
      toast.error('Failed to open conversation');
    } finally {
      setOpeningId(null);
    }
  }, [openingId, conversations, prependConversation, updateConversation, onSelectContact]);

  // Client-side filtering (status + channel) + sort by last activity
  const filtered = useMemo(() => {
    let list = contacts;

    if (statusFilter !== 'all') {
      if (statusFilter === 'requesting') {
        list = list.filter((c) => ['REQUESTED', 'INTERVENED'].includes(c.latestConversation?.status ?? ''));
      } else {
        list = list.filter((c) => c.latestConversation?.status === statusFilter);
      }
    }

    if (channelFilter !== 'all') {
      list = list.filter((c) => c.latestConversation?.channel?.type === channelFilter);
    }

    if (agentFilter !== 'all') {
      list = list.filter((c) => agentFilter === 'unassigned'
        ? !c.latestConversation?.assignedTo
        : c.latestConversation?.assignedTo?.id === agentFilter);
    }

    // Sort: contacts with recent activity first, then alphabetically
    return [...list].sort((a, b) => {
      const at = a.latestConversation?.lastMessageAt ? new Date(a.latestConversation.lastMessageAt).getTime() : 0;
      const bt = b.latestConversation?.lastMessageAt ? new Date(b.latestConversation.lastMessageAt).getTime() : 0;
      if (bt !== at) return bt - at;
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
    });
  }, [contacts, statusFilter, channelFilter, agentFilter]);

  const activeChannels = ['all', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM'];
  const activeFiltersCount = [statusFilter !== 'all', channelFilter !== 'all', !!tagFilter, agentFilter !== 'all'].filter(Boolean).length;

  return (
    <div className="w-[320px] border-r border-gray-100 bg-white flex flex-col flex-shrink-0 overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-teal-600" />
            <h2 className="text-sm font-semibold text-gray-900">Contacts</h2>
            {total > 0 && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{total.toLocaleString()}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onManage}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Manage
            </button>
            <button
              onClick={onCreateContact}
              title="New contact"
              className="w-7 h-7 flex items-center justify-center bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email…"
            className="w-full pl-8 pr-8 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white focus:border-transparent transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-lg font-medium transition-colors',
                statusFilter === tab.key
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
              )}
            >
              {tab.label}
            </button>
          ))}

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors',
              activeFiltersCount > 0 || showAdvanced
                ? 'bg-teal-50 text-teal-700'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
            )}
          >
            <SlidersHorizontal size={11} />
            {activeFiltersCount > 0 && (
              <span className="w-4 h-4 bg-teal-600 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Advanced filters panel */}
        {showAdvanced && (
          <div className="space-y-2 pt-1">
            {/* Channel filter */}
            <div className="relative">
              <button
                onClick={() => setShowChannelDropdown((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50 hover:bg-white transition-colors"
              >
                <span className="text-gray-600">{channelFilter === 'all' ? 'All channels' : channelFilter}</span>
                <ChevronDown size={12} className="text-gray-400" />
              </button>
              {showChannelDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                  {activeChannels.map((ch) => (
                    <button
                      key={ch}
                      onClick={() => { setChannelFilter(ch); setShowChannelDropdown(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors',
                        channelFilter === ch && 'text-teal-600 font-medium')}
                    >
                      {ch === 'all' ? 'All channels' : ch}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tag filter */}
            <div className="relative">
              <button
                onClick={() => setShowTagDropdown((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50 hover:bg-white transition-colors"
              >
                <span className={cn('flex items-center gap-1.5', tagFilter ? 'text-teal-700' : 'text-gray-600')}>
                  <Tag size={11} />
                  {tagFilter || 'All tags'}
                </span>
                <div className="flex items-center gap-1">
                  {tagFilter && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setTagFilter(''); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={11} />
                    </button>
                  )}
                  <ChevronDown size={12} className="text-gray-400" />
                </div>
              </button>
              {showTagDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 max-h-40 overflow-y-auto">
                  <button
                    onClick={() => { setTagFilter(''); setShowTagDropdown(false); }}
                    className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50', !tagFilter && 'text-teal-600 font-medium')}
                  >
                    All tags
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => { setTagFilter(tag); setShowTagDropdown(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50', tagFilter === tag && 'text-teal-600 font-medium')}
                    >
                      {tag}
                    </button>
                  ))}
                  {availableTags.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No tags yet</p>
                  )}
                </div>
              )}
            </div>

            {/* Agent/Assignee filter */}
            {teamMembers.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowAgentDropdown((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50 hover:bg-white transition-colors"
                >
                  <span className={cn('flex items-center gap-1.5', agentFilter !== 'all' ? 'text-teal-700' : 'text-gray-600')}>
                    <Users size={11} />
                    {agentFilter === 'all' ? 'All agents' :
                     agentFilter === 'unassigned' ? 'Unassigned' :
                     (teamMembers.find((m) => m.id === agentFilter)?.name ?? 'Agent')}
                  </span>
                  <div className="flex items-center gap-1">
                    {agentFilter !== 'all' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setAgentFilter('all'); }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X size={11} />
                      </button>
                    )}
                    <ChevronDown size={12} className="text-gray-400" />
                  </div>
                </button>
                {showAgentDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 max-h-40 overflow-y-auto">
                    <button
                      onClick={() => { setAgentFilter('all'); setShowAgentDropdown(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50', agentFilter === 'all' && 'text-teal-600 font-medium')}
                    >
                      All agents
                    </button>
                    <button
                      onClick={() => { setAgentFilter('unassigned'); setShowAgentDropdown(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50', agentFilter === 'unassigned' && 'text-teal-600 font-medium')}
                    >
                      Unassigned
                    </button>
                    {teamMembers.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setAgentFilter(m.id); setShowAgentDropdown(false); }}
                        className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50', agentFilter === m.id && 'text-teal-600 font-medium')}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Clear filters */}
            {activeFiltersCount > 0 && (
              <button
                onClick={() => { setStatusFilter('all'); setChannelFilter('all'); setTagFilter(''); setAgentFilter('all'); setShowAdvanced(false); }}
                className="w-full text-xs text-gray-500 hover:text-gray-700 py-1 text-center"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Contact list ── */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
        {loading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => <ContactSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Users size={20} className="text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">No contacts found</p>
            <p className="text-xs text-gray-400">
              {search || activeFiltersCount > 0 ? 'Try adjusting your search or filters' : 'Add your first contact to get started'}
            </p>
            {!search && activeFiltersCount === 0 && (
              <button
                onClick={onCreateContact}
                className="mt-4 text-xs font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1"
              >
                <Plus size={13} /> Add contact
              </button>
            )}
          </div>
        ) : (
          <>
            {filtered.map((contact) => {
              const isActive = contact.latestConversation?.id === activeConversationId;
              const isOpening = openingId === contact.id;
              const name = contact.name ?? contact.phone;
              const color = getAvatarColor(name);
              const conv = contact.latestConversation;
              const lastMsg = conv?.messages?.[0] ?? null;
              const unread = conv?.unreadCount ?? 0;
              const isRequesting = ['REQUESTED', 'INTERVENED'].includes(conv?.status ?? '');

              return (
                <button
                  key={contact.id}
                  onClick={() => { void handleSelect(contact); }}
                  disabled={isOpening}
                  className={cn(
                    'w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-150 relative group',
                    isActive
                      ? 'bg-teal-50 border-r-2 border-teal-600'
                      : 'hover:bg-gray-50 border-r-2 border-transparent',
                  )}
                >
                  {/* Avatar */}
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 relative', color)}>
                    {isOpening
                      ? <Loader2 size={16} className="animate-spin text-gray-500" />
                      : getInitials(name)}
                    {/* Online dot: WA session active */}
                    {conv && conv.lastMessageAt && (Date.now() - new Date(conv.lastMessageAt).getTime()) < 24 * 60 * 60 * 1000 && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white" />
                    )}
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className={cn('text-sm font-semibold truncate', isActive ? 'text-teal-900' : 'text-gray-900')}>
                        {name}
                      </span>
                      <span className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">
                        {conv?.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : ''}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <p className={cn(
                        'text-xs truncate leading-relaxed',
                        unread > 0 ? 'text-gray-700 font-medium' : 'text-gray-500',
                      )}>
                        {lastMsg
                          ? (lastMsg.direction === 'OUTBOUND' ? '↗ ' : '') + getMessagePreview(lastMsg)
                          : <span className="text-gray-400 italic">{contact.phone}</span>}
                      </p>
                      {unread > 0 && (
                        <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 bg-teal-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>

                    {/* Meta row: channel + status + tags */}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {conv?.channel && <ChannelBadge type={conv.channel.type} />}
                      {isRequesting && (
                        <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">Requesting</span>
                      )}
                      {conv?.status === 'RESOLVED' && (
                        <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">Resolved</span>
                      )}
                      {conv?.assignedTo && (
                        <span className="text-[9px] text-gray-400 truncate max-w-[60px]">@{conv.assignedTo.name.split(' ')[0]}</span>
                      )}
                      {contact.labels.slice(0, 2).map((l) => (
                        <span key={l} className="text-[9px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full max-w-[50px] truncate">
                          {l}
                        </span>
                      ))}
                      {contact.labels.length > 2 && (
                        <span className="text-[9px] text-gray-400">+{contact.labels.length - 2}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Load more */}
            {hasMore && (
              <div className="py-3 flex justify-center">
                {loadingMore ? (
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                ) : (
                  <button
                    onClick={() => { void loadContacts(page + 1, true); }}
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium px-4 py-1.5 rounded-lg hover:bg-teal-50 transition-colors"
                  >
                    Load more contacts
                  </button>
                )}
              </div>
            )}

            <div className="h-4" />
          </>
        )}
      </div>

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] text-gray-400 text-center">
            {filtered.length} of {total.toLocaleString()} contacts
          </p>
        </div>
      )}
    </div>
  );
}
