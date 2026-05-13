'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Edit2, X, Plus, ChevronDown, Check, Tag } from 'lucide-react';
import { cn, formatMessageTime, getInitials, truncate } from '@/lib/utils';
import { contactsApi, conversationsApi, tagsApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import toast from 'react-hot-toast';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
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
}

interface StatusCounts {
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
}

const STATUS_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'REQUESTED', label: 'Requesting' },
  { key: 'INTERVENED', label: 'Intervened' },
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
  const [display, setDisplay] = useState('');
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    if (!lastInboundAt) { setDisplay(''); return; }
    const update = () => {
      const remaining = 24 * 3600 * 1000 - (Date.now() - new Date(lastInboundAt).getTime());
      if (remaining <= 0) { setDisplay(''); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      setUrgent(remaining < 2 * 3600000);
      setDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [lastInboundAt]);

  if (!display) return null;
  return (
    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', urgent ? 'bg-orange-100 text-orange-600' : 'bg-blue-50 text-blue-600')}>
      ⏱ {display}
    </span>
  );
}

export default function ConversationList({ conversations, activeId, onSelect, loading, statusCounts }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('All');
  const [labelFilter, setLabelFilter] = useState('All');
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [savedTags, setSavedTags] = useState<{ id: string; name: string; color?: string }[]>([]);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const labelDropdownRef = useRef<HTMLDivElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [creating, setCreating] = useState(false);
  const { prependConversation } = useInboxStore();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target as Node)) setShowChannelDropdown(false);
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) setShowLabelDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    tagsApi.list().then(r => setSavedTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
  }, []);

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

  const filtered = conversations.filter((c) => {
    const name = c.contact.name ?? c.contact.phone;
    const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || c.contact.phone.includes(search);
    const matchesStatus = statusFilter === 'All' ? ['REQUESTED', 'INTERVENED'].includes(c.status) : c.status === statusFilter;
    const matchesChannel = channelFilter === 'All' || (c.channel?.type?.toUpperCase() ?? 'WHATSAPP') === channelFilter;
    const matchesLabel = labelFilter === 'All' || (c.labels ?? []).includes(labelFilter);
    return matchesSearch && matchesStatus && matchesChannel && matchesLabel;
  });

  const filteredContacts = contacts.filter((c) => {
    const name = c.name ?? c.phone;
    return name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch);
  });

  return (
    <div className="w-72 border-r border-gray-100 bg-white flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-teal-600">Message</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearch(''); }}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              {showSearch ? <X size={15} /> : <Search size={15} />}
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
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Filters: channel + label row, then status row */}
        <div className="flex flex-col gap-2">
          {/* Row 1: Channel + Label */}
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
              const count = f.key !== 'All' ? (statusCounts?.[f.key as keyof StatusCounts] ?? 0) : null;
              const isActive = statusFilter === f.key;
              const isUrgent = f.key === 'REQUESTED' && (count ?? 0) > 0;
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
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
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3 text-gray-400 text-sm">
            <p>No conversations found</p>
            <button
              onClick={() => { void openCompose(); }}
              className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              <Plus size={13} /> New conversation
            </button>
          </div>
        ) : (
          filtered.map((conv) => {
            const name = conv.contact.name ?? conv.contact.phone;
            const lastMsg = conv.messages?.[0];
            const isActive = conv.id === activeId;
            const avatarColor = getAvatarColor(name);

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left border-l-2',
                  isActive ? 'bg-gray-50 border-l-teal-600' : 'border-l-transparent',
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold', avatarColor)}>
                    {getInitials(name)}
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
                        : 'No messages yet'}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="ml-1.5 min-w-[18px] h-[18px] bg-teal-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 flex-shrink-0">
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
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
                      <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold">In progress</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
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
              <div className="max-h-72 overflow-y-auto space-y-0.5">
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
    </div>
  );
}
