'use client';
import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { Search, Edit2, X, Plus, ChevronDown, Check, Tag, Users, FileInput } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, formatMessageTime, getInitials, truncate } from '@/lib/utils';
import { contactsApi, conversationsApi, tagsApi, usersApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import toast from 'react-hot-toast';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels?: string[];
  messages?: Array<{ content: string | null; type: string }>;
  channel?: { id: string; type: string; name: string };
  slaDeadline?: string;
  requestedAt?: string;
  intervenedAt?: string;
  resolvedAt?: string;
  lastInboundAt?: string | null;
  activityLogs?: Array<{ action: string; metadata: Record<string, unknown> | null; createdAt: string }>;
}

interface StatusCounts {
  ACTIVE: number;
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
}

const STATUS_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'REQUESTED', label: 'Requests' },
  { key: 'RESOLVED', label: 'Resolved' },
];

const CHANNEL_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'MESSENGER', label: 'Messenger' },
  { key: 'INSTAGRAM', label: 'Instagram' },
];

function ConvChannelBadge({ channelType }: { channelType?: string }) {
  const type = (channelType ?? 'WHATSAPP').toUpperCase();
  if (type === 'MESSENGER' || type === 'FACEBOOK_MESSENGER') {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center border-2 border-white">
        <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.906 1.408 5.501 3.604 7.21V22l3.29-1.813C10.012 20.38 10.985 20.52 12 20.52c5.523 0 10-4.147 10-9.261C22 6.145 17.523 2 12 2zm1.05 12.474l-2.549-2.718-4.974 2.718 5.467-5.804 2.612 2.718 4.911-2.718-5.467 5.804z" />
        </svg>
      </div>
    );
  }
  if (type === 'INSTAGRAM') {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-white overflow-hidden" style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}>
        <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center border-2 border-white">
      <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    </div>
  );
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
  const { activityLogs: storeActivityLogs } = useInboxStore();
  if (!conv.contact) return null;
  const name = conv.contact.name ?? conv.contact.phone;
  const lastMsg = conv.messages?.[0];
  const avatarColor = getAvatarColor(name);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <button
        onClick={() => onSelect(conv.id)}
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
          <ConvChannelBadge channelType={conv.channel?.type} />
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
              {lastMsg?.content
                ? truncate(lastMsg.content, 38)
                : lastMsg?.type === 'IMAGE' ? '📷 Photo'
                : lastMsg?.type === 'VIDEO' ? '🎥 Video'
                : lastMsg?.type === 'AUDIO' ? '🎵 Audio'
                : lastMsg?.type === 'DOCUMENT' ? '📄 Document'
                : lastMsg?.type === 'LOCATION' ? '📍 Location'
                : lastMsg?.type === 'CONTACTS' ? '👤 Contact'
                : (() => {
                    const liveLogs = storeActivityLogs[conv.id];
                    const lastActivity = liveLogs
                      ? liveLogs[liveLogs.length - 1]
                      : conv.activityLogs?.[0];
                    if (lastActivity?.action === 'CALL_ENDED') {
                      const meta = lastActivity.metadata as { direction?: string; status?: string } | null;
                      const isMissed = meta?.status === 'MISSED' || meta?.status === 'FAILED';
                      const isOutbound = meta?.direction === 'OUTBOUND';
                      return isMissed ? (isOutbound ? '📞 Missed outbound call' : '📞 Missed call') : '📞 Voice call';
                    }
                    return conv.requestedAt ? 'Conversation opened' : 'New conversation';
                  })()}
            </span>
            {conv.unreadCount > 0 && (
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

export default function ConversationList({ conversations, activeId, onSelect, loading, statusCounts, onResolvedLoaded }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('All');
  const [labelFilter, setLabelFilter] = useState('All');
  const [memberFilter, setMemberFilter] = useState('All');
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [savedTags, setSavedTags] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([]);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const labelDropdownRef = useRef<HTMLDivElement>(null);
  const memberDropdownRef = useRef<HTMLDivElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Conversation[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [resolvedConversations, setResolvedConversations] = useState<Conversation[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target as Node)) setShowChannelDropdown(false);
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) setShowLabelDropdown(false);
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target as Node)) setShowMemberDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    tagsApi.list().then(r => setSavedTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
    usersApi.list().then(r => {
      const users = (r.data as { id: string; name: string }[]) ?? [];
      setTeamMembers(users);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await conversationsApi.list({ search: search.trim(), limit: 100, status: statusFilter !== 'All' ? statusFilter : undefined });
        const data = (res.data as { data: Conversation[] }).data;
        setSearchResults(data);
      } catch { /* silent */ }
      finally { setSearchLoading(false); }
    }, 350);
    return () => clearTimeout(timer);
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
      const res = await conversationsApi.create({ contactId: contact.id });
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

  const sourceConversations = statusFilter === 'RESOLVED' ? resolvedConversations : conversations;

  const filtered = useMemo(() => sourceConversations.filter((c) => {
    if (!c.contact) return false;
    const name = c.contact.name ?? c.contact.phone;
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || c.contact.phone.includes(search);
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    const matchesChannel = channelFilter === 'All' || (c.channel?.type?.toUpperCase() ?? 'WHATSAPP') === channelFilter;
    const matchesLabel = labelFilter === 'All' || (c.labels ?? []).includes(labelFilter);
    const matchesMember = statusFilter !== 'RESOLVED' || memberFilter === 'All'
      || (memberFilter === 'unassigned' ? c.assignedTo === null : c.assignedTo?.id === memberFilter);
    return matchesSearch && matchesStatus && matchesChannel && matchesLabel && matchesMember;
  }), [sourceConversations, search, statusFilter, channelFilter, labelFilter, memberFilter]);

  const filteredContacts = contacts.filter((c) => {
    const name = c.name ?? c.phone;
    return name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch);
  });

  return (
    <div className="w-72 border-r border-gray-100 bg-white flex flex-col h-full flex-shrink-0">
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

        {/* Filters: channel + label row, then status row */}
        <div className="flex flex-col gap-2">
          {/* Row 1: Channel + Label + Member */}
          <div className="flex items-center gap-2">
            {/* Channel filter */}
            <div className="relative flex-1" ref={channelDropdownRef}>
              <button
                onClick={() => setShowChannelDropdown((v) => !v)}
                className={cn(
                  'w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs rounded-xl border transition-colors font-medium',
                  channelFilter === 'All'
                    ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    : 'bg-teal-600 border-teal-600 text-white',
                )}
              >
                <span>{channelFilter === 'All' ? 'All Channels' : CHANNEL_FILTERS.find((f) => f.key === channelFilter)?.label ?? 'Channel'}</span>
                <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', showChannelDropdown && 'rotate-180')} />
              </button>
              {showChannelDropdown && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-full py-1">
                  {CHANNEL_FILTERS.map((f) => (
                    <button key={f.key} onClick={() => { setChannelFilter(f.key); setShowChannelDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 transition-colors text-gray-700">
                      <span className={channelFilter === f.key ? 'font-semibold text-teal-600' : ''}>{f.label}</span>
                      {channelFilter === f.key && <Check className="w-3 h-3 text-teal-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Label filter */}
            {savedTags.length > 0 && (
              <div className="relative flex-1" ref={labelDropdownRef}>
                <button onClick={() => setShowLabelDropdown(v => !v)}
                  className={cn('w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs rounded-xl border transition-colors font-medium',
                    labelFilter === 'All' ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-teal-600 border-teal-600 text-white')}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Tag size={11} className="flex-shrink-0" />
                    <span className="truncate">{labelFilter === 'All' ? 'All Labels' : labelFilter}</span>
                  </span>
                  <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', showLabelDropdown && 'rotate-180')} />
                </button>
                {showLabelDropdown && (
                  <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-full py-1">
                    <button onClick={() => { setLabelFilter('All'); setShowLabelDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 text-gray-700">
                      <span className={labelFilter === 'All' ? 'font-semibold text-teal-600' : ''}>All Labels</span>
                      {labelFilter === 'All' && <Check className="w-3 h-3 text-teal-600" />}
                    </button>
                    {savedTags.map(tag => (
                      <button key={tag.id} onClick={() => { setLabelFilter(tag.name); setShowLabelDropdown(false); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 text-gray-700">
                        <span className={cn('flex items-center gap-1.5', labelFilter === tag.name && 'font-semibold text-teal-600')}>
                          {tag.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />}
                          {tag.name}
                        </span>
                        {labelFilter === tag.name && <Check className="w-3 h-3 text-teal-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Row 2: Status tabs */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === 'All'
                ? ((statusCounts?.ACTIVE ?? 0) + (statusCounts?.REQUESTED ?? 0) + (statusCounts?.INTERVENED ?? 0))
                : (statusCounts?.[f.key as keyof StatusCounts] ?? 0);
              const isActive = statusFilter === f.key;
              const isUrgent = (f.key === 'REQUESTED' || f.key === 'INTERVENED') && (count ?? 0) > 0;
              return (
                <button key={f.key} onClick={() => { setStatusFilter(f.key); if (f.key !== 'RESOLVED') setMemberFilter('All'); }}
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
      <div className="flex-1 overflow-y-auto">
        {/* Member filter — only shown for Resolved tab */}
        {statusFilter === 'RESOLVED' && teamMembers.length > 0 && (
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-3 py-2" ref={memberDropdownRef}>
            <button
              onClick={() => { setShowMemberDropdown(v => !v); setMemberSearch(''); }}
              className={cn(
                'w-full flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-colors font-medium',
                memberFilter === 'All' ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-teal-600 border-teal-600 text-white',
              )}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <Users size={11} className="flex-shrink-0" />
                <span className="truncate">
                  {memberFilter === 'All' ? 'Filter by member' :
                   memberFilter === 'unassigned' ? 'Unassigned' :
                   (teamMembers.find(m => m.id === memberFilter)?.name ?? 'Member')}
                </span>
              </span>
              <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', showMemberDropdown && 'rotate-180')} />
            </button>
            {showMemberDropdown && (
              <div className="absolute left-3 right-3 top-full mt-0.5 bg-white border border-gray-200 rounded-xl shadow-lg z-30 py-1 overflow-hidden">
                <div className="px-2 pt-1 pb-1">
                  <div className="relative">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search members…"
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <button onClick={() => { setMemberFilter('All'); setShowMemberDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 text-gray-700">
                    <span className={memberFilter === 'All' ? 'font-semibold text-teal-600' : ''}>All Members</span>
                    {memberFilter === 'All' && <Check className="w-3 h-3 text-teal-600" />}
                  </button>
                  <button onClick={() => { setMemberFilter('unassigned'); setShowMemberDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 text-gray-700">
                    <span className={memberFilter === 'unassigned' ? 'font-semibold text-teal-600' : ''}>Unassigned</span>
                    {memberFilter === 'unassigned' && <Check className="w-3 h-3 text-teal-600" />}
                  </button>
                  {teamMembers
                    .filter(m => !memberSearch || (m.name ?? '').toLowerCase().includes(memberSearch.toLowerCase()))
                    .map(m => (
                      <button key={m.id} onClick={() => { setMemberFilter(m.id); setShowMemberDropdown(false); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 text-gray-700">
                        <span className={cn(memberFilter === m.id && 'font-semibold text-teal-600')}>{m.name}</span>
                        {memberFilter === m.id && <Check className="w-3 h-3 text-teal-600" />}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
        {(loading || resolvedLoading) ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
          </div>
        ) : (() => {
          const displayList = search.trim() ? searchResults : filtered;
          if (displayList.length === 0) return (
            <div className="flex flex-col items-center justify-center h-32 gap-3 text-gray-400 text-sm">
              <p>{search.trim() && !searchLoading ? `No results for "${search}"` : 'No conversations found'}</p>
              {!search && (
                <button onClick={() => { void openCompose(); }} className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium">
                  <Plus size={13} /> New conversation
                </button>
              )}
            </div>
          );
          return (
            <AnimatePresence initial={false}>
              {displayList.map((conv) => (
                <ConvRow key={conv.id} conv={conv} isActive={conv.id === activeId} onSelect={onSelect} />
              ))}
            </AnimatePresence>
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
                    const cName = c.name ?? c.phone;
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
