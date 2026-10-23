'use client';
import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { channelHasCustomerServiceWindow } from '@/lib/customer-service-window';
import { channelKindOf, matchesExplicitFilters, serverStatusParam } from '@/lib/inbox-search';
import { overlayLiveConversations } from '@/lib/inbox-merge';
import { ChannelBadge, CHANNEL_LABELS } from './ChannelBadge';
import { Search, Edit2, X, Plus, ChevronDown, Check, Tag, Users, FileInput, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, formatMessageTime, getInitials } from '@/lib/utils';
import { contactsApi, conversationsApi, tagsApi, usersApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import toast from 'react-hot-toast';
import { channelContactLabel, contactDisplayName, contactMatchesSearch } from '@/lib/contact-display';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels?: string[];
  messages?: Array<{ content: string | null; type: string; direction?: string }>;
  channel?: { id: string; type: string; name: string };
  slaDeadline?: string;
  requestedAt?: string;
  intervenedAt?: string;
  resolvedAt?: string;
  lastInboundAt?: string | null;
  activityLogs?: Array<{ action: string; metadata: Record<string, unknown> | null; createdAt: string }>;
}

interface StatusCounts {
  OPEN: number;
  REQUESTED: number;
  INTERVENED: number;
  RESOLVED: number;
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  statusCounts?: StatusCounts;
  onResolvedLoaded?: (convs: Conversation[]) => void;
  mobileHidden?: boolean;
  currentUserId?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const STATUS_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'REQUESTED', label: 'Requests' },
  { key: 'RESOLVED', label: 'Resolved' },
];

// Keys are the stored Channel.type values, so the filter can never drift from the data. (The Messenger key was
// 'MESSENGER' while conversations carry 'FACEBOOK_MESSENGER', so that filter never matched anything.)
const CHANNEL_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'WHATSAPP', label: CHANNEL_LABELS.WHATSAPP },
  { key: 'WHATSAPP_WEB', label: CHANNEL_LABELS.WHATSAPP_WEB },
  { key: 'FACEBOOK_MESSENGER', label: CHANNEL_LABELS.FACEBOOK_MESSENGER },
  { key: 'INSTAGRAM', label: CHANNEL_LABELS.INSTAGRAM },
];

const PREVIEW_RE = /__([^_\n]+)__|~([^~\n]+)~|\*([^*\n]+)\*|_([^_\n]+)_/g;

function renderPreviewText(text: string): React.ReactNode {
  const s = text.length > 50 ? text.slice(0, 50) + '…' : text;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  PREVIEW_RE.lastIndex = 0;
  while ((match = PREVIEW_RE.exec(s)) !== null) {
    if (match.index > lastIndex) parts.push(s.slice(lastIndex, match.index));
    if (match[1] !== undefined)      parts.push(<u key={match.index}>{match[1]}</u>);
    else if (match[2] !== undefined) parts.push(<del key={match.index}>{match[2]}</del>);
    else if (match[3] !== undefined) parts.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4] !== undefined) parts.push(<em key={match.index}>{match[4]}</em>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < s.length) parts.push(s.slice(lastIndex));
  if (parts.length === 0) return s;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-emerald-100 text-emerald-700',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface Contact { id: string; name: string | null; phone: string }

function SessionTimer({ lastInboundAt }: { lastInboundAt: string | null | undefined }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!lastInboundAt) { setRemaining(null); return; }
    const update = () => {
      setRemaining(24 * 3600 * 1000 - (Date.now() - new Date(lastInboundAt).getTime()));
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [lastInboundAt]);

  if (remaining === null) return null;

  if (remaining <= 0) {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 animate-pulse">
        Expired
      </span>
    );
  }

  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const colorClass =
    remaining < 3600000 ? 'bg-red-100 text-red-600' :
    remaining < 12 * 3600000 ? 'bg-amber-100 text-amber-600' :
    'bg-green-100 text-green-700';

  return (
    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', colorClass, remaining < 3600000 && 'animate-pulse')}>
      ⏱ {h}h:{String(m).padStart(2, '0')}m
    </span>
  );
}

const ConvRow = memo(function ConvRow({
  conv, isActive, onSelect,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const { activityLogs: storeActivityLogs, updateConversation } = useInboxStore();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const handleMarkUnread = async () => {
    setCtxMenu(null);
    try {
      await conversationsApi.markUnread(conv.id);
      updateConversation(conv.id, { unreadCount: 1 });
    } catch {
      toast.error('Failed to mark as unread');
    }
  };

  if (!conv.contact) return null;
  const name = contactDisplayName(conv.contact, undefined, channelContactLabel(conv.channel?.type));
  const lastMsg = conv.messages?.[0];
  const avatarColor = getAvatarColor(name);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="relative"
    >
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1 min-w-[170px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            onClick={() => { void handleMarkUnread(); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="w-4 h-4 rounded-full bg-teal-500 flex-shrink-0" />
            Mark as unread
          </button>
        </div>
      )}
      <button
        onClick={() => onSelect(conv.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          const x = Math.min(e.clientX, window.innerWidth - 180);
          const y = Math.min(e.clientY, window.innerHeight - 60);
          setCtxMenu({ x, y });
        }}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left border-l-2',
          isActive ? 'bg-gray-50 border-l-teal-600' : 'border-l-transparent',
        )}
      >
        <div className="relative flex-shrink-0">
          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold', avatarColor)}>
            {conv.contact.avatarUrl
              ? <img src={conv.contact.avatarUrl} alt={name} className="w-10 h-10 rounded-full object-cover" />
              : getInitials(name)}
          </div>
          <ChannelBadge channelType={conv.channel?.type} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
            {conv.lastMessageAt && (
              <span className="text-xs text-gray-400 flex-shrink-0 ml-1">
                {formatMessageTime(conv.lastMessageAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 truncate">
              {(() => {
                const liveLogs = storeActivityLogs[conv.id];
                const lastActivity = liveLogs
                  ? liveLogs[liveLogs.length - 1]
                  : conv.activityLogs?.[0];

                // Use activity label if it's newer than (or there is no) last message
                const msgTime = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
                const actTime = lastActivity?.createdAt ? new Date(lastActivity.createdAt).getTime() : 0;
                const showActivity = actTime > msgTime;

                if (!showActivity) {
                  if (lastMsg?.content) return renderPreviewText(lastMsg.content);
                  if (lastMsg?.type === 'IMAGE') return '📷 Photo';
                  if (lastMsg?.type === 'VIDEO') return '🎥 Video';
                  if (lastMsg?.type === 'AUDIO') return '🎵 Audio';
                  if (lastMsg?.type === 'DOCUMENT') return '📄 Document';
                  if (lastMsg?.type === 'LOCATION') return '📍 Location';
                  if (lastMsg?.type === 'CONTACTS') return '👤 Contact';
                }

                if (lastActivity) {
                  const meta = lastActivity.metadata as Record<string, unknown> | null;
                  switch (lastActivity.action) {
                    case 'CALL_ENDED': {
                      const isMissed = meta?.status === 'MISSED' || meta?.status === 'FAILED';
                      const isOutbound = meta?.direction === 'OUTBOUND';
                      return isMissed ? (isOutbound ? '📞 Missed outbound call' : '📞 Missed call') : '📞 Voice call';
                    }

                    case 'CONVERSATION_RESOLVED': return 'Conversation resolved';
                    case 'CONVERSATION_TRANSFERRED': return 'Conversation transferred';
                    case 'NOTE_ADDED': return 'Note added';
                    default: break;
                  }
                }

                return conv.requestedAt ? 'Conversation opened' : 'New conversation';
              })()}
            </span>
            {conv.unreadCount > 0 && conv.messages?.[0]?.direction !== 'OUTBOUND' && (
              <motion.span
                key={conv.unreadCount}
                initial={{ scale: 0.7 }}
                animate={{ scale: 1 }}
                className="ml-1.5 min-w-[18px] h-[18px] bg-teal-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 flex-shrink-0"
              >
                {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
              </motion.span>
            )}
          </div>
          <div className="flex gap-1 mt-1 flex-wrap items-center">
            {(conv.labels ?? []).slice(0, 2).map(l => (
              <span key={l} className="text-[9px] bg-teal-50 text-teal-600 border border-teal-100 px-1.5 py-0.5 rounded-full font-medium">{l}</span>
            ))}
            {(conv.labels ?? []).length > 2 && (
              <span className="text-[9px] text-gray-400">+{(conv.labels ?? []).length - 2}</span>
            )}
            {(conv.status === 'REQUESTED' || conv.status === 'INTERVENED') && (
              <SessionTimer lastInboundAt={conv.lastInboundAt} />
            )}
            {conv.status === 'REQUESTED' && (
              <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">Requesting</span>
            )}
            {conv.status === 'INTERVENED' && (
              <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">
                {conv.assignedTo?.name ? `By ${conv.assignedTo.name}` : 'Intervened'}
              </span>
            )}
          </div>
        </div>
      </button>
    </motion.div>
  );
});

export default function ConversationList({ conversations, activeId, onSelect, loading, statusCounts, onResolvedLoaded, mobileHidden, currentUserId, hasMore, loadingMore, onLoadMore }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('All');
  const [labelFilter, setLabelFilter] = useState('All');
  const [memberFilter, setMemberFilter] = useState('All');
  const [savedTags, setSavedTags] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [searchResults, setSearchResults] = useState<Conversation[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [resolvedConversations, setResolvedConversations] = useState<Conversation[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);
  const [requestedConversations, setRequestedConversations] = useState<Conversation[]>([]);
  const [requestedLoading, setRequestedLoading] = useState(false);
  const { prependConversation } = useInboxStore();

  // Fetch resolved conversations on demand when that tab is selected
  useEffect(() => {
    if (statusFilter !== 'RESOLVED') return;
    setResolvedLoading(true);
    conversationsApi.list({ status: 'RESOLVED', limit: 100 })
      .then(res => {
        const data = (res.data as { data: Conversation[] }).data ?? [];
        setResolvedConversations(data);
        onResolvedLoaded?.(data);
      })
      .catch(() => {})
      .finally(() => setResolvedLoading(false));
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch ALL requested conversations on demand — the live list is capped at 25 so
  // client-side filtering misses the rest.
  useEffect(() => {
    if (statusFilter !== 'REQUESTED') return;
    setRequestedLoading(true);
    conversationsApi.list({ status: 'REQUESTED', limit: 500 })
      .then(res => {
        const data = (res.data as { data: Conversation[] }).data ?? [];
        setRequestedConversations(data);
      })
      .catch(() => {})
      .finally(() => setRequestedLoading(false));
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge real-time socket updates (new REQUESTED conversations) into the local list
  // so they appear immediately without needing a refresh.
  useEffect(() => {
    if (statusFilter !== 'REQUESTED') return;
    setRequestedConversations(prev => {
      const existingIds = new Set(prev.map(c => c.id));
      const incoming = conversations.filter(c => c.status === 'REQUESTED' && !existingIds.has(c.id));
      return incoming.length > 0 ? [...incoming, ...prev] : prev;
    });
  }, [conversations, statusFilter]);


  useEffect(() => {
    tagsApi.list().then(r => setSavedTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
    usersApi.list().then(r => {
      const users = (r.data as { id: string; name: string }[]) ?? [];
      setTeamMembers(users);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); setSearchLoading(false); setSearchError(false); return; }
    setSearchLoading(true);
    // `cancelled` makes the latest search win: a slower response for an older term (or one that
    // lands after the box was cleared) must never overwrite newer results.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await conversationsApi.list({ search: search.trim(), limit: 100, status: serverStatusParam(statusFilter) });
        if (cancelled) return;
        setSearchResults((res.data as { data: Conversation[] }).data);
        setSearchError(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[inbox] conversation search failed', err instanceof Error ? err.message : err);
        setSearchResults([]);
        setSearchError(true);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, statusFilter]);

  const openCompose = useCallback(async () => {
    setShowCompose(true);
    setContactSearch('');
    setLoadingContacts(true);
    try {
      const res = await contactsApi.list({ limit: 100 });
      setContacts((res.data as { data: Contact[] }).data);
    } catch { toast.error('Failed to load contacts'); }
    finally { setLoadingContacts(false); }
  }, []);

  const startConversation = async (contact: Contact) => {
    setCreating(true);
    try {
      const res = await conversationsApi.findOrCreate(contact.id);
      const conv = res.data as Conversation & { contact: { id: string; name: string | null; phone: string; avatarUrl: string | null }; assignedTo: { id: string; name: string } | null };
      prependConversation({ ...conv, labels: [], messages: [] });
      onSelect(conv.id);
      setShowCompose(false);
    } catch { toast.error('Failed to start conversation'); }
    finally { setCreating(false); }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const res = await conversationsApi.importCsv(file);
      const { imported, skipped } = res.data as { imported: number; skipped: number };
      toast.success(`Imported ${imported} messages${skipped > 0 ? `, skipped ${skipped}` : ''}`);
      setShowImport(false);
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast.error(typeof msg === 'string' ? msg : 'Import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // The Resolved and Requests tabs fetch a snapshot; overlay the live store so new customer messages, unread
  // badges and reopened chats show up there too.
  const sourceConversations = useMemo(
    () => statusFilter === 'RESOLVED'
      ? overlayLiveConversations(resolvedConversations, conversations, 'RESOLVED')
      : statusFilter === 'REQUESTED'
        ? overlayLiveConversations(requestedConversations, conversations, 'REQUESTED')
        : conversations,
    [statusFilter, resolvedConversations, requestedConversations, conversations],
  );

  const TWENTY_FOUR_HOURS = 24 * 3600 * 1000;

  const filtered = useMemo(() => {
    const now = Date.now();
    return sourceConversations
      .filter((c) => {
        if (!c.contact) return false;
        // Hide expired (24h session elapsed) conversations from the default "All" view only —
        // an explicit tab like Requests must still surface stale unactioned conversations.
        if (statusFilter === 'All' && c.lastInboundAt && c.status !== 'RESOLVED' && channelHasCustomerServiceWindow(c.channel?.type)) {
          const elapsed = now - new Date(c.lastInboundAt).getTime();
          if (elapsed > TWENTY_FOUR_HOURS) return false;
        }
        // Resolved tab: only show conversations resolved within the past 24 hours
        if (c.status === 'RESOLVED' && statusFilter === 'RESOLVED') {
          const resolvedTime = c.resolvedAt ? new Date(c.resolvedAt).getTime() : (c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0);
          if (now - resolvedTime > TWENTY_FOUR_HOURS) return false;
        }
        const name = contactDisplayName(c.contact);
        const matchesSearch = contactMatchesSearch(c.contact, search);
        const matchesStatus = statusFilter === 'All'
          ? (c.status !== 'RESOLVED' && (c.status !== 'INTERVENED' || c.assignedTo?.id === currentUserId))
          : statusFilter === 'UNREPLIED'
            ? c.status !== 'RESOLVED'
            : c.status === statusFilter;
        const matchesChannel = channelFilter === 'All' || channelKindOf(c.channel?.type) === channelFilter;
        const matchesLabel = labelFilter === 'All' || (c.labels ?? []).includes(labelFilter);
        // Pending tab: show all agents' unreplied chats regardless of assignment
        const matchesMember = statusFilter === 'UNREPLIED'
          ? true
          : memberFilter === 'All'
            ? (statusFilter !== 'All' || !currentUserId || c.assignedTo === null || c.assignedTo?.id === currentUserId)
            : (memberFilter === 'unassigned' ? c.assignedTo === null : c.assignedTo?.id === memberFilter);
        const matchesUnreplied = statusFilter !== 'UNREPLIED' || c.messages?.[0]?.direction === 'INBOUND';
        return matchesSearch && matchesStatus && matchesChannel && matchesLabel && matchesMember && matchesUnreplied;
      });
  }, [sourceConversations, search, statusFilter, channelFilter, labelFilter, memberFilter]);

  const filteredContacts = contacts.filter((c) => {
    const name = contactDisplayName(c);
    return contactMatchesSearch(c, contactSearch);
  });

  // Groups of INTERVENED conversations from other agents, shown below main list when in "All" tab
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());

  const intervenedGroups = useMemo(() => {
    if (statusFilter !== 'All' || memberFilter !== 'All') return [];
    const now = Date.now();
    const allIntervened = sourceConversations.filter((c) => {
      if (c.status !== 'INTERVENED') return false;
      if (!c.assignedTo) return false;
      if (c.assignedTo.id === currentUserId) return false;
      if (!c.contact) return false;
      if (c.lastInboundAt && channelHasCustomerServiceWindow(c.channel?.type)) {
        const elapsed = now - new Date(c.lastInboundAt).getTime();
        if (elapsed > TWENTY_FOUR_HOURS) return false;
      }
      if (search.trim()) {
        const name = contactDisplayName(c.contact);
        if (!contactMatchesSearch(c.contact, search)) return false;
      }
      return true;
    });
    const map = new Map<string, { agent: { id: string; name: string }; convs: Conversation[] }>();
    for (const conv of allIntervened) {
      if (!conv.assignedTo) continue;
      const { id, name } = conv.assignedTo;
      if (!map.has(id)) map.set(id, { agent: { id, name }, convs: [] });
      map.get(id)!.convs.push(conv);
    }
    return Array.from(map.values());
  }, [sourceConversations, statusFilter, memberFilter, search, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('w-full md:w-72 border-r border-gray-100 bg-white flex flex-col h-full flex-shrink-0', mobileHidden && 'hidden md:flex')}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-teal-600">Inbox</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearch(''); }}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              {showSearch ? <X size={15} /> : <Search size={15} />}
            </button>
            <button
              onClick={() => setShowImport(true)}
              title="Import conversations from CSV"
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <FileInput size={15} />
            </button>
            <button
              onClick={() => { void openCompose(); }}
              title="New conversation"
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <Edit2 size={15} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="relative mb-3">
            {searchLoading
              ? <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />}
            <input
              type="text"
              placeholder="Search name, phone, or message..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            {search && !searchLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{searchResults.length}</span>}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-2">
          {/* Row 1: Channel + Agent — always on same line */}
          <div className="flex items-center gap-2">
            <Dropdown
              className="flex-1"
              menuClassName="min-w-full"
              trigger={
                <div className={cn(
                  'w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs rounded-xl border transition-colors font-medium',
                  channelFilter === 'All' ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-teal-600 border-teal-600 text-white',
                )}>
                  <span className="truncate">{channelFilter === 'All' ? 'All Channels' : CHANNEL_FILTERS.find((f) => f.key === channelFilter)?.label ?? 'Channel'}</span>
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                </div>
              }
            >
              {CHANNEL_FILTERS.map((f) => (
                <DropdownItem key={f.key} onClick={() => setChannelFilter(f.key)} className="text-xs justify-between">
                  <span className={channelFilter === f.key ? 'font-semibold text-teal-600' : ''}>{f.label}</span>
                  {channelFilter === f.key && <Check className="w-3 h-3 text-teal-600" />}
                </DropdownItem>
              ))}
            </Dropdown>

            {teamMembers.length > 0 && (
              <Dropdown
                className="flex-1 min-w-0"
                menuClassName="right-0 min-w-full"
                trigger={
                  <div className={cn(
                    'w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs rounded-xl border transition-colors font-medium overflow-hidden',
                    memberFilter === 'All' ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-teal-600 border-teal-600 text-white',
                  )}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Users size={11} className="flex-shrink-0" />
                      <span className="truncate">
                        {memberFilter === 'All' ? 'All Agents' :
                         memberFilter === 'unassigned' ? 'Unassigned' :
                         (teamMembers.find(m => m.id === memberFilter)?.name ?? 'Agent')}
                      </span>
                    </span>
                    <ChevronDown className="w-3 h-3 flex-shrink-0" />
                  </div>
                }
              >
                <DropdownItem onClick={() => setMemberFilter('All')} className="text-xs justify-between">
                  <span className={memberFilter === 'All' ? 'font-semibold text-teal-600' : ''}>All Agents</span>
                  {memberFilter === 'All' && <Check className="w-3 h-3 text-teal-600" />}
                </DropdownItem>
                <DropdownItem onClick={() => setMemberFilter('unassigned')} className="text-xs justify-between">
                  <span className={memberFilter === 'unassigned' ? 'font-semibold text-teal-600' : ''}>Unassigned</span>
                  {memberFilter === 'unassigned' && <Check className="w-3 h-3 text-teal-600" />}
                </DropdownItem>
                {teamMembers.map(m => (
                  <DropdownItem key={m.id} onClick={() => setMemberFilter(m.id)} className="text-xs justify-between">
                    <span className={cn(memberFilter === m.id && 'font-semibold text-teal-600')}>{m.name}</span>
                    {memberFilter === m.id && <Check className="w-3 h-3 text-teal-600" />}
                  </DropdownItem>
                ))}
              </Dropdown>
            )}
          </div>

          {/* Row 2: Label filter (only when labels exist) */}
          {savedTags.length > 0 && (
            <Dropdown
              className="flex-1"
              menuClassName="min-w-full"
              trigger={
                <div className={cn('w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs rounded-xl border transition-colors font-medium',
                  labelFilter === 'All' ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-teal-600 border-teal-600 text-white')}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Tag size={11} className="flex-shrink-0" />
                    <span className="truncate">{labelFilter === 'All' ? 'All Labels' : labelFilter}</span>
                  </span>
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                </div>
              }
            >
              <DropdownItem onClick={() => setLabelFilter('All')} className="text-xs justify-between">
                <span className={labelFilter === 'All' ? 'font-semibold text-teal-600' : ''}>All Labels</span>
                {labelFilter === 'All' && <Check className="w-3 h-3 text-teal-600" />}
              </DropdownItem>
              {savedTags.map(tag => (
                <DropdownItem key={tag.id} onClick={() => setLabelFilter(tag.name)} className="text-xs justify-between">
                  <span className={cn('flex items-center gap-1.5', labelFilter === tag.name && 'font-semibold text-teal-600')}>
                    {tag.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />}
                    {tag.name}
                  </span>
                  {labelFilter === tag.name && <Check className="w-3 h-3 text-teal-600" />}
                </DropdownItem>
              ))}
            </Dropdown>
          )}

          {/* Status tabs */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === 'All'
                ? conversations.filter(c => {
                    if (c.status === 'RESOLVED' || c.status === 'INTERVENED') return false;
                    if (c.lastInboundAt) {
                      const elapsed = Date.now() - new Date(c.lastInboundAt).getTime();
                      if (elapsed > TWENTY_FOUR_HOURS) return false;
                    }
                    if (currentUserId && c.assignedTo !== null && c.assignedTo?.id !== currentUserId) return false;
                    return true;
                  }).length
                : f.key === 'RESOLVED'
                  ? (statusCounts?.RESOLVED ?? null)
                  : f.key === 'REQUESTED'
                    ? (statusCounts?.REQUESTED ?? null)
                    : conversations.filter(c => c.status === f.key).length;
              const isActive = statusFilter === f.key;
              const isUrgent = (f.key === 'REQUESTED' || f.key === 'INTERVENED') && (count ?? 0) > 0;
              return (
                <button key={f.key} onClick={() => { setStatusFilter(f.key); setMemberFilter('All'); }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 text-[10px] rounded-lg transition-colors font-semibold whitespace-nowrap',
                    isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  )}>
                  {f.label}
                  {count !== null && count > 0 && (
                    <span className={cn('min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-0.5', isUrgent ? 'bg-orange-500 text-white' : isActive ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-600')}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          if (statusFilter !== 'All' || search.trim() || !hasMore || loadingMore || !onLoadMore) return;
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) onLoadMore();
        }}
      >
        {(loading || resolvedLoading || requestedLoading) ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
          </div>
        ) : (() => {
          const displayList = search.trim()
            ? searchResults.filter((c) => matchesExplicitFilters(c, { channelFilter, labelFilter, memberFilter }))
            : filtered;
          const hasMain = displayList.length > 0;
          const hasGroups = intervenedGroups.length > 0;

          if (!hasMain && !hasGroups) return (
            <div className="flex flex-col items-center justify-center h-32 gap-3 text-gray-400 text-sm">
              <p>{search.trim() && !searchLoading ? (searchError ? "Search failed. Check your connection and try again." : `No results for "${search}"`) : 'No conversations found'}</p>
              {!search && (
                <button onClick={() => { void openCompose(); }} className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium">
                  <Plus size={13} /> New conversation
                </button>
              )}
            </div>
          );

          return (
            <>
              <AnimatePresence initial={false}>
                {displayList.map((conv) => (
                  <ConvRow key={conv.id} conv={conv} isActive={conv.id === activeId} onSelect={onSelect} />
                ))}
              </AnimatePresence>

              {statusFilter === 'All' && !search.trim() && loadingMore && (
                <div className="flex items-center justify-center py-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-600" />
                </div>
              )}

              {/* Intervened by other agents — grouped sections */}
              {hasGroups && (
                <div className="mt-1">
                  <div className="px-4 py-2 flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Handled by Team</span>
                  </div>
                  {intervenedGroups.map(({ agent, convs }) => {
                    const isCollapsed = collapsedAgents.has(agent.id);
                    const initials = getInitials(agent.name);
                    return (
                      <div key={agent.id}>
                        <button
                          onClick={() => setCollapsedAgents(prev => {
                            const next = new Set(prev);
                            if (next.has(agent.id)) next.delete(agent.id); else next.add(agent.id);
                            return next;
                          })}
                          className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 text-[9px] font-bold flex-shrink-0">
                              {initials}
                            </div>
                            <span className="text-xs font-semibold text-gray-600">{agent.name}</span>
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold leading-none">
                              {convs.length}
                            </span>
                          </div>
                          {isCollapsed
                            ? <ChevronRight size={12} className="text-gray-400" />
                            : <ChevronDown size={12} className="text-gray-400" />
                          }
                        </button>
                        {!isCollapsed && (
                          <AnimatePresence initial={false}>
                            {convs.map((conv) => (
                              <ConvRow key={conv.id} conv={conv} isActive={conv.id === activeId} onSelect={onSelect} />
                            ))}
                          </AnimatePresence>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Compose / New conversation modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowCompose(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">New Conversation</h3>
              <button onClick={() => setShowCompose(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search contacts…"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {loadingContacts ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-4">No contacts found</p>
                ) : (
                  filteredContacts.map((c) => {
                    const cName = contactDisplayName(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => { void startConversation(c); }}
                        disabled={creating}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-teal-50 rounded-xl text-left transition-colors disabled:opacity-50"
                      >
                        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', getAvatarColor(cName))}>
                          {getInitials(cName)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cName}</p>
                          <p className="text-xs text-gray-500">{c.phone}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import CSV modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">Import Conversations</h3>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                Import conversation history from AiSensy, Interakt, or any CSV export.<br />
                Required column: <code className="bg-gray-100 px-1 rounded text-gray-700">phone</code><br />
                Optional columns: <code className="bg-gray-100 px-1 rounded text-gray-700">name</code>, <code className="bg-gray-100 px-1 rounded text-gray-700">content</code>, <code className="bg-gray-100 px-1 rounded text-gray-700">direction</code> (INBOUND/OUTBOUND), <code className="bg-gray-100 px-1 rounded text-gray-700">type</code> (TEXT/IMAGE/VIDEO/DOCUMENT), <code className="bg-gray-100 px-1 rounded text-gray-700">timestamp</code>, <code className="bg-gray-100 px-1 rounded text-gray-700">mediaUrl</code>
              </p>
              <input ref={importFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void handleImportFile(e); }} />
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {importing ? (
                  <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Importing…</>
                ) : (
                  <><FileInput size={15} /> Select CSV file</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
