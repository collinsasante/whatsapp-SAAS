'use client';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Send, Paperclip, CheckCheck, Check, Clock, XCircle, Mic, Square,
  X, FileText, ImageIcon, MapPin, User, Smile, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  CheckCircle, RefreshCw, Copy, StickyNote, Archive,
  Reply, SmilePlus, Star, Search, UserPlus, Pin, Info, ArrowRightLeft, Forward,
  AlertCircle, MessageSquare, StickyNote as NoteIcon, Images, Tag, Download,
  ChevronUp, ChevronDown, ChevronLeft, LogIn, Brain, BellOff, ShieldOff, Shield, Pencil, Trash2,
  Bold, Italic, Strikethrough, Underline, Sparkles, ThumbsUp,
} from 'lucide-react';
import dynamic from 'next/dynamic';
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });
import { messagesApi, mediaApi, contactsApi, conversationsApi, usersApi, activityLogApi, tagsApi, templatesApi, aiLogsApi } from '@/lib/api';
import CannedPicker from './CannedPicker';
import LibraryPickerModal from './LibraryPickerModal';
import { LinkPreview, extractFirstUrl } from './LinkPreview';
import toast from 'react-hot-toast';
import { showConfirm } from '@/store/confirm.store';
import { useInboxStore } from '@/store/inbox.store';
import { useAuthStore } from '@/store/auth.store';
import { useCallsStore } from '@/store/calls.store';
import { getSocket, SocketEvent } from '@/lib/socket';
import { cn, getInitials, formatMessageTime, getProxiedMediaUrl, getDownloadFilename, getApiError } from '@/lib/utils';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useTheme } from 'next-themes';
import { offlineQueue } from '@/lib/offline-queue';
import { useOfflineStore } from '@/store/offline.store';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const META_VIDEO_LIMIT_MB = 2048;
import { MessageStatus, MessageDirection } from '@whatsapp-platform/shared-types';
import type { Message } from '@whatsapp-platform/shared-types';
import type { ActivityEntry } from '@/store/inbox.store';

interface TeamMember { id: string; name: string; email: string; avatarUrl?: string | null; }

interface Conversation {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  labels?: string[];
  unreadCount?: number;
  lastMessageAt?: string | null;
  channel?: { id: string; type: string; name: string };
  slaDeadline?: string;
  requestedAt?: string;
  intervenedAt?: string;
  resolvedAt?: string;
  lastInboundAt?: string | null;
  priority?: number;
  reopenedCount?: number;
  adSourceId?: string | null;
  adHeadline?: string | null;
  adImageUrl?: string | null;
  contactSource?: string | null;
}

interface Props {
  conversation: Conversation;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  onClose?: () => void;
  onMobileBack?: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  [MessageStatus.QUEUED]: <Clock size={11} className="text-white/60" />,
  [MessageStatus.SENT]: <Check size={11} className="text-white/80" />,
  [MessageStatus.DELIVERED]: <CheckCheck size={11} className="text-white/80" />,
  [MessageStatus.READ]: <CheckCheck size={11} className="text-white" />,
  [MessageStatus.FAILED]: <XCircle size={11} className="text-red-300" />,
};


const LOCATION_DURATIONS = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
];

const AVATAR_COLORS = ['bg-teal-100 text-teal-700','bg-blue-100 text-blue-700','bg-purple-100 text-purple-700','bg-orange-100 text-orange-700','bg-pink-100 text-pink-700'];
function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function ChannelBadge({ channelType }: { channelType?: string }) {
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
  // Default: WhatsApp
  return (
    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center border-2 border-white">
      <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    </div>
  );
}

function SessionCountdown({ lastInboundAt }: { lastInboundAt: string | null | undefined }) {
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
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 animate-pulse">
        Session Expired
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
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', colorClass, remaining < 3600000 && 'animate-pulse')}>
      ⏱ {h}h:{String(m).padStart(2, '0')}m
    </span>
  );
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { label: string; messages: Message[] }[] = [];
  let currentLabel = '';
  for (const msg of messages) {
    const d = new Date(msg.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let label: string;
    if (d.toDateString() === today.toDateString()) label = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (label !== currentLabel) { groups.push({ label, messages: [msg] }); currentLabel = label; }
    else groups[groups.length - 1].messages.push(msg);
  }
  return groups;
}

function fmtTimestamp(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const ACTIVITY_NOISE = new Set(['MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_STARRED', 'MESSAGE_RECEIVED']);

export default function ChatWindow({ conversation, showDetails, onToggleDetails, onClose, onMobileBack }: Props) {
  const { messages, setMessages, prependMessages, addMessage, typingUsers, removeMessage, removeConversation, updateConversation, updateMessage, activityLogs, setActivityLogs } = useInboxStore();
  const { user } = useAuthStore();
  const { setConfirmDial, outboundSession } = useCallsStore();
  const isOnline = useNetworkStatus();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { setQueuedCounts } = useOfflineStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [addrQuery, setAddrQuery] = useState('');
  const [addrResults, setAddrResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [addrSearching, setAddrSearching] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [popupPos, setPopupPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 80 });
  const [liveLocation, setLiveLocation] = useState<{ active: boolean; expiresAt: number; intervalId: ReturnType<typeof setInterval> | null }>({ active: false, expiresAt: 0, intervalId: null });

  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [localStatus, setLocalStatus] = useState(conversation.status);
  const [tookOver, setTookOver] = useState(false);
  const [isBlocked, setIsBlocked] = useState(() => !!(conversation.contact as { isBlocked?: boolean } | undefined)?.isBlocked);
  const isAtBottomRef = useRef(true);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const prevMsgLengthRef = useRef(0);

  // Keep localStatus in sync when the conversation status changes via socket
  useEffect(() => {
    setLocalStatus(conversation.status);
  }, [conversation.status]);

  // Keep isBlocked in sync when switching conversations
  useEffect(() => {
    setIsBlocked(!!(conversation.contact as { isBlocked?: boolean } | undefined)?.isBlocked);
  }, [conversation.id, (conversation.contact as { isBlocked?: boolean } | undefined)?.isBlocked]);
  const [replyTo, setReplyTo] = useState<{ id: string; content?: string; type: string; direction: string; mediaCaption?: string } | null>(null);

  // Transfer
  const [showTransfer, setShowTransfer] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [transferring, setTransferring] = useState(false);

  // Drag & drop
  const [isDragging, setIsDragging] = useState(false);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);

  // Input mode: 'message' | 'note'
  const [inputMode, setInputMode] = useState<'message' | 'note'>('message');
  const [savingNote, setSavingNote] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ logId: string; response: string; confidence: number | null } | null>(null);
  const [aiSuggestionSending, setAiSuggestionSending] = useState(false);
  const [aiFeedbackLogId, setAiFeedbackLogId] = useState<string | null>(null);

  // Older-message pagination
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Add label (contact-level)
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [savedTags, setSavedTags] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [contactLabels, setContactLabels] = useState<string[]>([]);

  // Snooze
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [customSnoozeVal, setCustomSnoozeVal] = useState('');
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  // @mention
  const [mentionSearch, setMentionSearch] = useState('');
  const [showMentions, setShowMentions] = useState(false);

  // Canned responses
  const [showCanned, setShowCanned] = useState(false);
  const cannedQuery = text.startsWith('/') ? text.slice(1) : '';
  const cannedVars = useMemo(() => ({
    customer_name: conversation.contact?.name ?? conversation.contact?.phone ?? '',
    agent_name: user?.name ?? 'Agent',
    phone: conversation.contact?.phone ?? '',
    email: (conversation.contact as { email?: string } | undefined)?.email ?? '',
    ticket_id: conversation.id.slice(0, 8).toUpperCase(),
    conversation_id: conversation.id,
    current_date: new Date().toLocaleDateString(),
    current_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }), [conversation, user]);

  const handleCannedSelect = useCallback((resolvedText: string, mediaUrl?: string, mediaType?: string) => {
    setShowCanned(false);
    if (mediaUrl) {
      const rawType = (mediaType ?? '').toUpperCase();
      const type = rawType.startsWith('IMAGE') ? 'IMAGE' : rawType.startsWith('VIDEO') ? 'VIDEO' : rawType.startsWith('AUDIO') ? 'AUDIO' : 'DOCUMENT';
      setSending(true);
      messagesApi.send(conversation.id, { type, mediaUrl, ...(resolvedText ? { mediaCaption: resolvedText } : {}) })
        .catch(() => toast.error('Failed to send canned media'))
        .finally(() => { setSending(false); inputRef.current?.focus(); });
      setText('');
    } else {
      setText(resolvedText);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [conversation.id]);

  const activityLog = activityLogs[conversation.id] ?? [];

  // Notes displayed inline in chat
  const [notes, setNotes] = useState<{ id: string; content: string; createdAt: string; author: { id: string; name: string } }[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const applyFormat = (prefix: string, suffix: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length + selected.length);
    });
  };

  // Auto-grow textarea height to match content (max ~5 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);

  const convMessages = messages[conversation.id] ?? [];
  const typing = typingUsers[conversation.id] ?? [];
  const isResolved = localStatus === 'RESOLVED';
  const isArchived = localStatus === 'ARCHIVED';
  const name = conversation.contact?.name ?? conversation.contact?.phone ?? '';
  const avatarColor = getAvatarColor(name);

  const lastInboundMsg = [...convMessages].reverse().find((m) => m.direction === MessageDirection.INBOUND);
  const sessionExpiredMs = 24 * 60 * 60 * 1000;
  const sessionExpired = !lastInboundMsg || (Date.now() - new Date(lastInboundMsg.createdAt).getTime()) > sessionExpiredMs;
  const isExpiredResolved = isResolved && sessionExpired;

  type TimelineItem =
    | { kind: 'message'; item: Message; sortKey: number }
    | { kind: 'note'; item: typeof notes[number]; sortKey: number }
    | { kind: 'activity'; item: ActivityEntry; sortKey: number };

  const timeline = useMemo<TimelineItem[]>(() => [
    ...convMessages.map((m) => ({ kind: 'message' as const, item: m, sortKey: new Date(m.createdAt).getTime() })),
    ...notes.map((n) => ({ kind: 'note' as const, item: n, sortKey: new Date(n.createdAt).getTime() })),
    ...activityLog
      .filter((a) => !ACTIVITY_NOISE.has(a.action))
      .map((a) => ({ kind: 'activity' as const, item: a, sortKey: new Date(a.createdAt).getTime() })),
  ].sort((a, b) => a.sortKey - b.sortKey), [convMessages, notes, activityLog]);

  const timelineGroups = useMemo(() => {
    const groups: { label: string; items: TimelineItem[] }[] = [];
    let currentLabel = '';
    for (const entry of timeline) {
      const d = new Date(entry.sortKey);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let label: string;
      if (d.toDateString() === today.toDateString()) label = 'Today';
      else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
      else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      if (label !== currentLabel) { groups.push({ label, items: [entry] }); currentLabel = label; }
      else groups[groups.length - 1].items.push(entry);
    }
    return groups;
  }, [timeline]);

  type FlatTimelineItem =
    | { kind: 'date-header'; label: string; _id: string }
    | TimelineItem;

  const flatItems = useMemo<FlatTimelineItem[]>(() => {
    const result: FlatTimelineItem[] = [];
    for (const group of timelineGroups) {
      result.push({ kind: 'date-header', label: group.label, _id: `hdr-${group.label}` });
      for (const item of group.items) result.push(item);
    }
    return result;
  }, [timelineGroups]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (i) => {
      const item = flatItems[i];
      if (!item) return i;
      if (item.kind === 'date-header') return item._id;
      if (item.kind === 'note') return `note-${item.item.id}`;
      if (item.kind === 'activity') return `act-${item.item.id}`;
      return item.item.id;
    },
  });

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
    });
  }, []);


  useEffect(() => {
    const socket = getSocket();
    socket.emit(SocketEvent.JOIN_CONVERSATION, conversation.id);
    return () => { socket.emit(SocketEvent.LEAVE_CONVERSATION, conversation.id); };
  }, [conversation.id]);

  useEffect(() => {
    const socket = getSocket();
    const handler = (data: { conversationId: string; suggestion: { logId: string; response: string; confidence: number | null } }) => {
      if (data.conversationId === conversation.id) {
        setAiSuggestion(data.suggestion);
      }
    };
    socket.on(SocketEvent.AI_SUGGESTION, handler);
    return () => { socket.off(SocketEvent.AI_SUGGESTION, handler); };
  }, [conversation.id]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setHasMoreOlder(false);
      try {
        const [msgsRes, notesRes, activityRes] = await Promise.allSettled([
          messagesApi.list(conversation.id, { limit: 100 }),
          conversationsApi.getNotes(conversation.id),
          activityLogApi.forConversation(conversation.id),
        ]);
        if (msgsRes.status === 'fulfilled') {
          const payload = msgsRes.value.data as { data: Message[]; hasMore?: boolean };
          setMessages(conversation.id, payload.data);
          setHasMoreOlder(!!payload.hasMore);
          scrollToBottom(true);
          // Second scroll after virtualizer re-measures actual item heights
          requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)));
        }
        if (notesRes.status === 'fulfilled') setNotes(notesRes.value.data as typeof notes);
        if (activityRes.status === 'fulfilled') setActivityLogs(conversation.id, (activityRes.value.data as ActivityEntry[]) ?? []);
        void conversationsApi.markRead(conversation.id).catch(() => {});
        updateConversation(conversation.id, { unreadCount: 0 });
      } finally { setLoading(false); }
    };
    void load();
  }, [conversation.id, setMessages, updateConversation, setActivityLogs]);

  // Client-side search — compute matching message IDs whenever query or messages change
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResultIds([]); setSearchCurrentIdx(0); return; }
    const q = searchQuery.toLowerCase().trim();
    const ids = convMessages
      .filter((m) => (
        m.content?.toLowerCase().includes(q) ||
        m.mediaCaption?.toLowerCase().includes(q)
      ))
      .map((m) => m.id);
    setSearchResultIds(ids);
    setSearchCurrentIdx(0);
  }, [searchQuery, convMessages]);

  // Scroll to current search result when index changes.
  // Step 1: scrollToIndex uses estimated sizes — gets us close immediately.
  // Step 2: after React re-renders the now-visible items and the virtualizer
  //         re-measures them, scrollToIndex again with actual sizes for precision.
  // Step 3: as a final fallback, scrollIntoView on the DOM node itself.
  useEffect(() => {
    if (!searchResultIds.length) return;
    const id = searchResultIds[searchCurrentIdx];
    if (!id) return;
    const idx = flatItems.findIndex((it) => it.kind === 'message' && it.item.id === id);
    if (idx === -1) return;
    virtualizer.scrollToIndex(idx, { align: 'center' });
    const t1 = setTimeout(() => {
      virtualizer.scrollToIndex(idx, { align: 'center' });
      const el = document.getElementById(`msg-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    const t2 = setTimeout(() => {
      const el = document.getElementById(`msg-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [searchCurrentIdx, searchResultIds, flatItems, virtualizer]);

  const scrollToMessage = useCallback((msgId: string) => {
    const idx = flatItems.findIndex((it) => it.kind === 'message' && it.item.id === msgId);
    if (idx === -1) return;
    virtualizer.scrollToIndex(idx, { align: 'center' });
    setTimeout(() => {
      virtualizer.scrollToIndex(idx, { align: 'center' });
      const el = document.getElementById(`msg-${msgId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background-color 0.3s ease';
        el.style.backgroundColor = '#ccfbf1';
        setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
      }
    }, 150);
  }, [flatItems, virtualizer]);

  // Reset scroll tracking on conversation change
  useEffect(() => {
    isAtBottomRef.current = true;
    setNewMsgCount(0);
    prevMsgLengthRef.current = 0;
  }, [conversation.id]);

  // Track scroll position to gate auto-scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;
      isAtBottomRef.current = atBottom;
      if (atBottom) setNewMsgCount(0);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [conversation.id]);

  // Load the next batch of older messages when user clicks the banner
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || convMessages.length === 0) return;
    const oldest = convMessages[0];
    setLoadingOlder(true);
    try {
      const res = await messagesApi.list(conversation.id, { limit: 100, before: oldest.createdAt });
      const payload = res.data as { data: Message[]; hasMore?: boolean };
      if (payload.data.length === 0) { setHasMoreOlder(false); return; }

      // Save scroll height before prepend so we can restore position afterwards
      const container = scrollContainerRef.current;
      const prevHeight = container?.scrollHeight ?? 0;

      prependMessages(conversation.id, payload.data);
      setHasMoreOlder(!!payload.hasMore);

      // Restore scroll position so the user stays at the same message
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - prevHeight;
        }
      });
    } catch {
      // silently ignore
    } finally {
      setLoadingOlder(false);
    }
  }, [conversation.id, convMessages, hasMoreOlder, loadingOlder, prependMessages]);

  // Auto-scroll when new messages arrive (only if already at bottom)
  useEffect(() => {
    const len = convMessages.length;
    if (len === 0) { prevMsgLengthRef.current = 0; return; }
    if (isAtBottomRef.current) {
      scrollToBottom();
      setNewMsgCount(0);
    } else if (len > prevMsgLengthRef.current && prevMsgLengthRef.current > 0) {
      setNewMsgCount((c) => c + (len - prevMsgLengthRef.current));
    }
    prevMsgLengthRef.current = len;
  }, [convMessages.length, scrollToBottom]);

  useEffect(() => {
    return () => {
      setLiveLocation((prev) => {
        if (prev.intervalId) clearInterval(prev.intervalId);
        return { active: false, expiresAt: 0, intervalId: null };
      });
    };
  }, [conversation.id]);

  useEffect(() => { setLocalStatus(conversation.status); }, [conversation.status]);
  useEffect(() => { setTookOver(false); }, [conversation.id]);

  // Auto-focus the message input whenever a new conversation is opened
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [conversation.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) setShowHeaderMenu(false);
    };
    if (showHeaderMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHeaderMenu]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (snoozeMenuRef.current && !snoozeMenuRef.current.contains(e.target as Node)) setShowSnoozeMenu(false);
    };
    if (showSnoozeMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSnoozeMenu]);

  useEffect(() => {
    if (conversation.contact?.id) {
      contactsApi.get(conversation.contact.id)
        .then(r => setContactLabels((r.data as { labels?: string[] }).labels ?? []))
        .catch(() => {});
    }
  }, [conversation.contact?.id]);

  useEffect(() => {
    if (showAddLabel && savedTags.length === 0) {
      tagsApi.list().then(r => setSavedTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
    }
  }, [showAddLabel, savedTags.length]);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  const loadTeamMembers = useCallback(async () => {
    if (teamMembers.length > 0) return;
    try {
      const res = await usersApi.list();
      setTeamMembers(res.data as TeamMember[]);
    } catch (err) { toast.error(getApiError(err, 'Failed to load team members')); }
  }, [teamMembers.length]);

  // Pre-load team members when note mode is active (needed for @mention)
  useEffect(() => {
    if (inputMode === 'note') void loadTeamMembers();
  }, [inputMode, loadTeamMembers]);

  const openTransfer = () => { setShowTransfer(true); void loadTeamMembers(); setShowHeaderMenu(false); };

  const handleTransfer = async (memberId: string, memberName: string) => {
    setTransferring(true);
    try {
      await conversationsApi.transfer(conversation.id, memberId);
      updateConversation(conversation.id, { assignedTo: { id: memberId, name: memberName }, status: 'REQUESTED' });
      toast.success(`Transferred to ${memberName}`);
      setShowTransfer(false);
    } catch (err) { toast.error(getApiError(err, 'Failed to transfer conversation')); }
    finally { setTransferring(false); }
  };

  const closeMenus = useCallback(() => {
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    setShowHeaderMenu(false);
  }, []);

  const handleTyping = useCallback(() => {
    const socket = getSocket();
    socket.emit(SocketEvent.TYPING_START, { conversationId: conversation.id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit(SocketEvent.TYPING_STOP, { conversationId: conversation.id });
    }, 2000);
  }, [conversation.id]);

  // Auto-reopen when typing in closed conversation
  const handleTextChange = useCallback(async (val: string) => {
    setText(val);
    handleTyping();

    // Canned response detection: starts with /
    if (inputMode === 'message' && val.startsWith('/')) {
      setShowCanned(true);
    } else {
      setShowCanned(false);
    }

    // @mention detection in note mode
    if (inputMode === 'note') {
      const atIdx = val.lastIndexOf('@');
      if (atIdx !== -1) {
        const after = val.slice(atIdx + 1);
        if (!after.includes(' ')) {
          setMentionSearch(after);
          setShowMentions(true);
        } else {
          setShowMentions(false);
        }
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }

  }, [conversation.id, handleTyping, inputMode]);

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        const file = new File([blob], 'voice-note.ogg', { type: 'audio/ogg' });
        setSending(true);
        try {
          const uploadRes = await mediaApi.upload(file);
          const { fileUrl: url } = uploadRes.data as { fileUrl: string };
          await messagesApi.send(conversation.id, { type: 'AUDIO', mediaUrl: url, mediaCaption: 'Voice note' });
        } catch { toast.error('Failed to send voice note'); }
        finally { setSending(false); }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch { toast.error('Microphone access denied'); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) { mediaRecorderRef.current.stop(); mediaRecorderRef.current = null; }
    setRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setRecording(false);
  };

  const sendMessage = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();

    const replyToId = replyTo?.id;
    setText('');
    setReplyTo(null);
    inputRef.current?.focus();

    if (inputMode === 'note') {
      setSavingNote(true);
      try {
        const res = await conversationsApi.addNote(conversation.id, content);
        const created = res.data as { id: string; content: string; createdAt: string; author: { id: string; name: string } };
        setNotes((prev) => [...prev, created]);
        toast.success('Note added');
      } catch { toast.error('Failed to add note'); setText(content); }
      finally { setSavingNote(false); }
      return;
    }

    const tempId = `temp-${Date.now()}`;
    addMessage(conversation.id, {
      id: tempId,
      content,
      type: 'TEXT',
      status: 'QUEUED',
      direction: MessageDirection.OUTBOUND,
      createdAt: new Date().toISOString(),
      conversationId: conversation.id,
      tenantId: '',
      contactId: conversation.contact?.phone ?? '',
    } as unknown as Message);

    if (!isOnline) {
      const queueId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        await offlineQueue.enqueueMessage({
          id: queueId,
          tempId,
          conversationId: conversation.id,
          payload: { content, type: 'TEXT', ...(replyToId ? { replyToId } : {}) },
          createdAt: new Date().toISOString(),
        });
        const [msgs, drafts] = await Promise.all([offlineQueue.getAllMessages(), offlineQueue.getAllDrafts()]);
        setQueuedCounts(msgs.length, drafts.length);
      } catch {
        // Local storage (IndexedDB) is unavailable/broken on this device — don't leave the
        // customer thinking an unsent message was queued.
        removeMessage(conversation.id, tempId);
        toast.error('Could not save message for offline sending on this device. Please retry once back online.');
      }
      return;
    }

    setSending(true);
    try {
      const res = await messagesApi.send(conversation.id, { content, type: 'TEXT', ...(replyToId ? { replyToId } : {}) });
      // Replace temp immediately from API response — don't wait for socket (socket may be down)
      const real = res.data as Message;
      if (real?.id) {
        removeMessage(conversation.id, tempId);
        addMessage(conversation.id, real);
      }
    } catch (err) {
      removeMessage(conversation.id, tempId);
      setText(content);
      toast.error(getApiError(err, 'Failed to send message'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const sendFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (!isOnline) {
      toast.error('File uploads require an internet connection. Reconnect and try again.');
      return;
    }
    setSending(true);
    const total = files.length;
    const toastId = total > 1 ? toast.loading(`Uploading 1 of ${total}…`) : null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (toastId && total > 1) toast.loading(`Uploading ${i + 1} of ${total}…`, { id: toastId });
      const maxBytes = file.type.startsWith('video/') ? META_VIDEO_LIMIT_MB * 1024 * 1024 : 64 * 1024 * 1024;
      if (file.size > maxBytes) {
        toast.error(`${file.name}: too large. Max ${file.type.startsWith('video/') ? META_VIDEO_LIMIT_MB + 'MB' : '64MB'}`);
        continue;
      }
      const type = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
      const carriesFilename = type === 'DOCUMENT' || type === 'AUDIO';
      // Show the message immediately while uploading
      const previewUrl = (type === 'IMAGE' || type === 'VIDEO') ? URL.createObjectURL(file) : null;
      const tempId = `temp-${Date.now()}-${i}`;
      addMessage(conversation.id, {
        id: tempId, content: null, type, status: 'QUEUED' as MessageStatus,
        direction: MessageDirection.OUTBOUND,
        createdAt: new Date().toISOString(), conversationId: conversation.id,
        tenantId: '', contactId: '', senderId: null, whatsappMessageId: null,
        mediaUrl: previewUrl, mediaType: null, mediaSize: null,
        mediaCaption: carriesFilename ? file.name : null,
        templateId: null, templateVariables: null, metadata: null,
        sentAt: null, deliveredAt: null, readAt: null, failedAt: null, failureReason: null,
        replyToId: null, isStarred: false, isPinned: false, isEdited: false,
        editedAt: null, deletedForEveryone: false, deletedAt: null,
      } as unknown as Message);
      try {
        const uploadRes = await mediaApi.upload(file);
        const { fileUrl: url } = uploadRes.data as { fileUrl: string };
        const res = await messagesApi.send(conversation.id, { type, mediaUrl: url, ...(carriesFilename ? { mediaCaption: file.name } : {}) });
        const real = res.data as Message;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        removeMessage(conversation.id, tempId);
        if (real?.id) addMessage(conversation.id, real);
      } catch (err: unknown) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        removeMessage(conversation.id, tempId);
        toast.error(getApiError(err, `Failed to send ${file.name}`));
      }
    }
    if (toastId) toast.success(`${total} file${total > 1 ? 's' : ''} sent`, { id: toastId });
    setSending(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (photoInputRef.current) photoInputRef.current.value = '';
  }, [conversation.id, addMessage, removeMessage]);

  const sendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    void sendFiles(files);
  };

  const sendCurrentPosition = useCallback(async (label: string) => {
    return new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await messagesApi.send(conversation.id, { type: 'LOCATION', locationLatitude: pos.coords.latitude, locationLongitude: pos.coords.longitude, locationName: label });
            resolve();
          } catch { reject(new Error('Failed to send location')); }
        },
        () => reject(new Error('Location access denied')),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }, [conversation.id]);

  const searchAddress = async () => {
    if (!addrQuery.trim()) return;
    setAddrSearching(true);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(addrQuery)}`, { headers: { 'Accept-Language': 'en' } });
      const data = await r.json() as { display_name: string; lat: string; lon: string }[];
      setAddrResults(data);
    } catch { toast.error('Address search failed'); }
    finally { setAddrSearching(false); }
  };

  const sendSpecificAddress = async (lat: string, lon: string, name: string) => {
    setShowLocationPicker(false);
    setAddrQuery(''); setAddrResults([]);
    try {
      await messagesApi.send(conversation.id, { type: 'LOCATION', locationLatitude: parseFloat(lat), locationLongitude: parseFloat(lon), locationName: name });
    } catch { toast.error('Failed to send location'); }
  };

  const startLiveLocation = async (minutes: number) => {
    closeMenus();
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    try { await sendCurrentPosition('Live Location'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Location error'); return; }
    toast.success(`Sharing live location for ${minutes < 60 ? minutes + ' min' : minutes / 60 + 'h'}`);
    const expiresAt = Date.now() + minutes * 60 * 1000;
    const intervalId = setInterval(async () => {
      if (Date.now() >= expiresAt) { stopLiveLocation(); return; }
      try { await sendCurrentPosition('Live Location'); } catch { /* silent */ }
    }, 30_000);
    setLiveLocation({ active: true, expiresAt, intervalId });
  };

  const stopLiveLocation = useCallback(() => {
    setLiveLocation((prev) => { if (prev.intervalId) clearInterval(prev.intervalId); return { active: false, expiresAt: 0, intervalId: null }; });
    toast('Location sharing stopped');
  }, []);

  const openContactPicker = async () => {
    closeMenus();
    try {
      const res = await contactsApi.list({ limit: 100 });
      setContacts((res.data as { data: { id: string; name: string | null; phone: string }[] }).data);
      setShowContactPicker(true);
    } catch { toast.error('Failed to load contacts'); }
  };

  const sendContact = async (c: { name: string | null; phone: string }) => {
    setShowContactPicker(false);
    setSending(true);
    try {
      await messagesApi.send(conversation.id, { type: 'CONTACTS', contactName: c.name ?? c.phone, contactPhone: c.phone });
    } catch { toast.error('Failed to send contact'); }
    finally { setSending(false); }
  };

  const handleResolve = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.resolve(conversation.id);
      setLocalStatus('RESOLVED');
      updateConversation(conversation.id, { status: 'RESOLVED' });
      toast.success('Conversation resolved');
    } catch (err) { toast.error(getApiError(err, 'Failed to resolve conversation')); }
  };

  const handleReopen = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.reopen(conversation.id);
      setLocalStatus('OPEN');
      updateConversation(conversation.id, { status: 'OPEN', slaDeadline: undefined, requestedAt: undefined });
      toast.success('Conversation reopened');
    } catch (err) { toast.error(getApiError(err, 'Failed to reopen conversation')); }
  };

  const handleTakeover = async () => {
    try {
      const res = await conversationsApi.takeover(conversation.id);
      const data = res.data as { status: string; assignedTo?: { id: string; name: string }; slaDeadline?: string; intervenedAt?: string };
      setLocalStatus('INTERVENED');
      setTookOver(true);
      updateConversation(conversation.id, {
        status: 'INTERVENED',
        assignedTo: data.assignedTo ?? (user ? { id: user.id, name: user.name } : null),
        slaDeadline: data.slaDeadline,
        intervenedAt: data.intervenedAt,
      });
      toast.success('You have taken over this conversation');
    } catch (err) { toast.error(getApiError(err, 'Failed to take over conversation')); }
  };

  const handleIntervene = async () => {
    setShowHeaderMenu(false);
    try {
      const res = await conversationsApi.intervene(conversation.id);
      const data = res.data as { status: string; assignedTo?: { id: string; name: string }; slaDeadline?: string; intervenedAt?: string };
      setLocalStatus('INTERVENED');
      updateConversation(conversation.id, {
        status: 'INTERVENED',
        assignedTo: data.assignedTo ?? (user ? { id: user.id, name: user.name } : null),
        slaDeadline: data.slaDeadline,
        intervenedAt: data.intervenedAt,
      });
      toast.success('You are now handling this conversation');
    } catch (err) { toast.error(getApiError(err, 'Failed to intervene — conversation may have been taken by another agent')); }
  };

  const handleMarkPending = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.update(conversation.id, { status: 'PENDING' });
      setLocalStatus('PENDING');
      updateConversation(conversation.id, { status: 'PENDING' });
      toast.success('Marked as pending');
    } catch (err) { toast.error(getApiError(err, 'Failed to update status')); }
  };

  const handleArchive = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.archive(conversation.id);
      setLocalStatus('ARCHIVED');
      toast.success('Conversation archived');
    } catch (err) { toast.error(getApiError(err, 'Failed to archive conversation')); }
  };

  const handleToggleBlock = async () => {
    const contactId = conversation.contact?.id;
    if (!contactId) return;
    try {
      const res = await contactsApi.block(contactId);
      const { isBlocked: blocked } = res.data as { isBlocked: boolean };
      setIsBlocked(blocked);
      toast.success(blocked ? 'Contact blocked' : 'Contact unblocked');
    } catch (err) { toast.error(getApiError(err, 'Failed to update block status')); }
  };

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      await conversationsApi.deleteNote(conversation.id, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    } catch { toast.error('Failed to delete note'); }
  }, [conversation.id]);

  const handleEditNote = useCallback(async (noteId: string, content: string) => {
    try {
      const res = await conversationsApi.editNote(conversation.id, noteId, content);
      const updated = res.data as { id: string; content: string; createdAt: string; author: { id: string; name: string } };
      setNotes((prev) => prev.map((n) => n.id === noteId ? updated : n));
    } catch { toast.error('Failed to update note'); }
  }, [conversation.id]);

  const handleSnooze = async (until: Date) => {
    setShowSnoozeMenu(false);
    try {
      await conversationsApi.update(conversation.id, { snoozedUntil: until.toISOString() });
      removeConversation(conversation.id);
      if (onClose) onClose();
      const timeLabel = until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateLabel = until.toDateString() === new Date().toDateString()
        ? `today at ${timeLabel}`
        : `${until.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${timeLabel}`;
      toast.success(`Snoozed until ${dateLabel}`);
    } catch (err) { toast.error(getApiError(err, 'Failed to snooze conversation')); }
  };

  const snoozeOptions: { label: string; until: () => Date }[] = [
    { label: '30 minutes', until: () => new Date(Date.now() + 30 * 60_000) },
    { label: '1 hour',     until: () => new Date(Date.now() + 60 * 60_000) },
    { label: '2 hours',    until: () => new Date(Date.now() + 2 * 60 * 60_000) },
    { label: '4 hours',    until: () => new Date(Date.now() + 4 * 60 * 60_000) },
    {
      label: 'Tomorrow 9am',
      until: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];

  const handleAddLabel = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || !conversation.contact?.id) return;
    if (contactLabels.includes(trimmed)) { toast.error('Label already added'); return; }
    const updated = [...contactLabels, trimmed];
    try {
      await contactsApi.update(conversation.contact.id, { labels: updated });
      setContactLabels(updated);
      setLabelInput('');
      toast.success(`Label "${trimmed}" added`);
      const alreadySaved = savedTags.some(t => t.name.toLowerCase() === trimmed.toLowerCase());
      if (!alreadySaved) {
        try {
          const r = await tagsApi.create({ name: trimmed });
          setSavedTags(prev => [...prev, r.data as { id: string; name: string; color?: string }]);
        } catch { /* tag may already exist — non-fatal */ }
      }
    } catch (err) { toast.error(getApiError(err, 'Failed to add label')); }
  };

  const handleRemoveLabel = async (label: string) => {
    if (!conversation.contact?.id) return;
    const updated = contactLabels.filter(l => l !== label);
    try {
      await contactsApi.update(conversation.contact.id, { labels: updated });
      setContactLabels(updated);
    } catch (err) { toast.error(getApiError(err, 'Failed to remove label')); }
  };

  const selectMention = useCallback((member: TeamMember) => {
    const atIdx = text.lastIndexOf('@');
    if (atIdx !== -1) setText(text.slice(0, atIdx) + '@' + member.name + ' ');
    setShowMentions(false);
    setMentionSearch('');
  }, [text]);

  const handleDeleteConversation = async () => {
    setShowHeaderMenu(false);
    if (!await showConfirm('Delete this conversation?', { subtext: 'All messages will be permanently deleted. This cannot be undone.' })) return;
    try {
      await conversationsApi.delete(conversation.id);
      removeConversation(conversation.id);
      toast.success('Conversation deleted');
    } catch (err) { toast.error(getApiError(err, 'Failed to delete conversation')); }
  };

  const isRequested = localStatus === 'REQUESTED';
  const isIntervened = localStatus === 'INTERVENED';

  const handleDownloadChat = () => {
    const lines: string[] = [`Conversation with ${name}`, `Exported: ${new Date().toLocaleString()}`, '─'.repeat(50), ''];
    for (const entry of timeline) {
      if (entry.kind === 'message') {
        const m = entry.item;
        const ts = new Date(m.createdAt).toLocaleString();
        const sender = m.direction === 'OUTBOUND' ? 'Agent' : name;
        const body = m.content ?? (m.mediaUrl ? `[${m.type} media]` : `[${m.type}]`);
        lines.push(`[${ts}] ${sender}: ${body}`);
      } else if (entry.kind === 'note') {
        const n = entry.item;
        const ts = new Date(n.createdAt).toLocaleString();
        lines.push(`[${ts}] 📝 NOTE (${n.author.name}): ${n.content}`);
      } else {
        const a = entry.item;
        const ts = new Date(a.createdAt).toLocaleString();
        lines.push(`[${ts}] ── ${a.action.replace(/_/g, ' ').toLowerCase()}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${name.replace(/\s+/g, '-')}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowHeaderMenu(false);
    toast.success('Chat exported');
  };

  const sessionBlocked = !loading && sessionExpired && !isResolved && !isRequested;
  const isViewer = user?.role === 'VIEWER';
  const assigneeId = conversation.assignedTo?.id ?? null;
  const isVerzAssigned = !!(conversation.assignedTo as unknown as { isAiAgent?: boolean } | null)?.isAiAgent;
  // Any assigned conversation is locked to its owner — everyone else must take over first.
  // tookOver bypasses the gate immediately after a successful takeover API call.
  const assignedToOther = !tookOver && !!assigneeId && assigneeId !== user?.id;
  // VIEWERs are read-only — they can observe but never send or note.
  const inputDisabled = isViewer || assignedToOther || isBlocked || (inputMode === 'note' ? savingNote : (savingNote || isResolved || isRequested || sessionBlocked));
  const sendDisabled = sending || inputDisabled;
  const statusColor =
    localStatus === 'RESOLVED' ? 'text-gray-400' :
    localStatus === 'ARCHIVED' ? 'text-gray-400' :
    localStatus === 'REQUESTED' ? 'text-orange-600' :
    localStatus === 'INTERVENED' ? 'text-indigo-600' :
    'text-teal-600';

  return (
    <div
      className="flex-1 flex flex-col bg-white dark:bg-gray-900 min-h-0 relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => !f.type.startsWith('text/'));
        if (files.length) void sendFiles(files);
      }}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-teal-50/95 border-2 border-dashed border-teal-400 rounded-none flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Paperclip size={24} className="text-teal-600" />
            </div>
            <p className="text-teal-700 font-semibold text-sm">Drop files to send</p>
            <p className="text-teal-500 text-xs mt-1">Images, videos, documents</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3 px-4 py-3">
            {/* Mobile back button */}
            {onMobileBack && (
              <button
                onClick={onMobileBack}
                className="md:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors flex-shrink-0"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold', avatarColor)}>
                {getInitials(name)}
              </div>
              <ChannelBadge channelType={conversation.channel?.type} />
            </div>
            {/* Name + status + labels */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm truncate">{name}</h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className={cn('text-xs font-medium', statusColor)}>
                  {localStatus === 'RESOLVED' ? (isExpiredResolved ? 'Session expired' : 'Resolved') :
                   localStatus === 'ARCHIVED' ? 'Archived' :
                   localStatus === 'REQUESTED' ? 'Awaiting agent' :
                   localStatus === 'INTERVENED' ? 'Agent intervened' :
                   localStatus}
                </p>
                {!isArchived && (
                  <SessionCountdown lastInboundAt={conversation.lastInboundAt} />
                )}
                {(conversation.labels ?? []).slice(0, 3).map(l => (
                  <span key={l} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-full font-medium">{l}</span>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Intervene — always visible */}
              {isRequested && !assignedToOther && (
                <button
                  onClick={() => { void handleIntervene(); }}
                  title="Take over this conversation"
                  className="h-8 px-2.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <UserPlus size={13} />
                  <span className="hidden sm:inline">Intervene</span>
                </button>
              )}

              {/* Take over — always visible */}
              {assignedToOther && localStatus !== 'RESOLVED' && localStatus !== 'ARCHIVED' && (
                <button
                  onClick={() => { void handleTakeover(); }}
                  title="Take over from current agent"
                  className="h-8 px-3 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <UserPlus size={13} />
                  <span className="hidden sm:inline">Take Over</span>
                </button>
              )}

              {/* Resolve / Reopen — always visible */}
              {localStatus !== 'RESOLVED' && localStatus !== 'ARCHIVED' && !assignedToOther ? (
                <button
                  onClick={() => { void handleResolve(); }}
                  title="Resolve"
                  className="h-8 px-2.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <CheckCircle size={13} />
                  <span className="hidden sm:inline">Resolve</span>
                </button>
              ) : isResolved ? (
                <button
                  onClick={() => { void handleReopen(); }}
                  title="Reopen"
                  className="h-8 px-2.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  <span className="hidden sm:inline">Reopen</span>
                </button>
              ) : null}

              {/* Snooze — desktop only */}
              {localStatus !== 'RESOLVED' && localStatus !== 'ARCHIVED' && (
                <div className="relative hidden md:block" ref={snoozeMenuRef}>
                  <button
                    onClick={() => setShowSnoozeMenu((v) => !v)}
                    title="Snooze conversation"
                    className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showSnoozeMenu ? 'bg-amber-50 text-amber-600' : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50')}
                  >
                    <BellOff size={15} />
                  </button>
                  {showSnoozeMenu && (
                    <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-52 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-3 pt-1 pb-1.5">Snooze until</p>
                      {snoozeOptions.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => { void handleSnooze(opt.until()); }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                        >
                          {opt.label}
                        </button>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1 px-3 pb-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Custom</p>
                        <div className="flex gap-1.5">
                          <input
                            type="datetime-local"
                            value={customSnoozeVal}
                            onChange={(e) => setCustomSnoozeVal(e.target.value)}
                            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                          <button
                            onClick={() => { if (customSnoozeVal) void handleSnooze(new Date(customSnoozeVal)); }}
                            disabled={!customSnoozeVal}
                            className="text-xs px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-40 transition-colors font-semibold"
                          >
                            Set
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Transfer — desktop only */}
              <button
                onClick={openTransfer}
                title="Transfer to team member"
                className="hidden md:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <ArrowRightLeft size={15} />
              </button>

              {/* Add Label — desktop only button; panel is portalled so works from mobile menu too */}
              <div className="relative hidden md:block" ref={labelMenuRef}>
                <button
                  onClick={() => setShowAddLabel((v) => !v)}
                  title="Add label"
                  className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showAddLabel ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50')}
                >
                  <Tag size={15} />
                </button>
              </div>
              {/* Label panel — rendered via portal so it works on mobile too */}
              {showAddLabel && typeof document !== 'undefined' && createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddLabel(false)} />
                  <div className="fixed right-4 top-16 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-64 p-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Labels</p>
                    {contactLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {contactLabels.map((l) => (
                          <span key={l} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full">
                            {l}
                            <button onClick={() => { void handleRemoveLabel(l); }} className="text-teal-400 hover:text-teal-600 ml-0.5">
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {savedTags.filter(t => !contactLabels.includes(t.name)).length > 0 && (
                      <div className="mb-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Saved Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {savedTags.filter(t => !contactLabels.includes(t.name)).map(tag => (
                            <button key={tag.id} onClick={() => { void handleAddLabel(tag.name); }}
                              className="text-xs px-2.5 py-1 rounded-full border transition-colors hover:opacity-80"
                              style={{ borderColor: tag.color ?? '#e5e7eb', color: tag.color ?? '#374151', backgroundColor: tag.color ? tag.color + '20' : '#f9fafb' }}>
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <input type="text" value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddLabel(labelInput); } }}
                        placeholder="Custom label…"
                        className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        autoFocus
                      />
                      <button onClick={() => { void handleAddLabel(labelInput); }} disabled={!labelInput.trim()}
                        className="px-2.5 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 font-medium">
                        Add
                      </button>
                    </div>
                  </div>
                </>,
                document.body,
              )}

              {/* Customer Info toggle — desktop only */}
              {onToggleDetails && (
                <button
                  onClick={onToggleDetails}
                  title={showDetails ? 'Hide customer info' : 'Show customer info'}
                  className={cn('hidden md:flex w-8 h-8 items-center justify-center rounded-lg transition-colors', showDetails ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50')}
                >
                  <Info size={15} />
                </button>
              )}

              {/* Search — desktop only */}
              <button
                onClick={() => setShowSearch(true)}
                title="Search messages"
                className="hidden md:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Search size={15} />
              </button>

              {/* Call — desktop only */}
              <button
                onClick={() => {
                  if (conversation.contact?.phone) setConfirmDial({ phone: conversation.contact.phone, contactName: conversation.contact.name ?? conversation.contact.phone, contactId: conversation.contact.id });
                }}
                title="Call"
                className="hidden md:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Phone size={15} />
              </button>

              {/* Block contact — desktop only */}
              <button
                onClick={() => { void handleToggleBlock(); }}
                title={isBlocked ? 'Unblock contact' : 'Block contact'}
                className={cn('hidden md:flex w-8 h-8 items-center justify-center rounded-lg transition-colors', isBlocked ? 'text-red-500 bg-red-50 hover:bg-red-100' : 'text-gray-400 hover:text-red-500 hover:bg-red-50')}
              >
                {isBlocked ? <ShieldOff size={15} /> : <Shield size={15} />}
              </button>

              {/* Download chat — desktop only */}
              <button
                onClick={handleDownloadChat}
                title="Download chat"
                className="hidden md:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Download size={15} />
              </button>

              {/* Mobile "more" menu — hidden on desktop */}
              <div className="relative md:hidden" ref={headerMenuRef}>
                <button
                  onClick={() => setShowHeaderMenu((v) => !v)}
                  title="More actions"
                  className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showHeaderMenu ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50')}
                >
                  <ChevronDown size={16} />
                </button>
                {showHeaderMenu && (
                  <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-56 py-1.5 max-h-[80vh] overflow-y-auto">
                    <button onClick={() => { openTransfer(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      <ArrowRightLeft size={14} className="text-gray-400" /> Transfer
                    </button>
                    {localStatus !== 'RESOLVED' && localStatus !== 'ARCHIVED' && (
                      <>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-4 pt-2 pb-1">Snooze until</p>
                        {snoozeOptions.map((opt) => (
                          <button key={opt.label} onClick={() => { void handleSnooze(opt.until()); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-700 text-left">
                            <BellOff size={14} className="text-gray-400" /> {opt.label}
                          </button>
                        ))}
                        <div className="border-t border-gray-100 mt-1" />
                      </>
                    )}
                    <button onClick={() => { setShowAddLabel(true); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      <Tag size={14} className="text-gray-400" /> Labels
                    </button>
                    {onToggleDetails && (
                      <button onClick={() => { onToggleDetails(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                        <Info size={14} className="text-gray-400" /> {showDetails ? 'Hide Info' : 'Customer Info'}
                      </button>
                    )}
                    <button onClick={() => { setShowSearch(true); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      <Search size={14} className="text-gray-400" /> Search
                    </button>
                    <button onClick={() => {
                      if (conversation.contact?.phone) setConfirmDial({ phone: conversation.contact.phone, contactName: conversation.contact.name ?? conversation.contact.phone, contactId: conversation.contact.id });
                      setShowHeaderMenu(false);
                    }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      <Phone size={14} className="text-gray-400" /> Call
                    </button>
                    <button onClick={() => { void handleToggleBlock(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      {isBlocked ? <ShieldOff size={14} className="text-red-400" /> : <Shield size={14} className="text-gray-400" />}
                      {isBlocked ? 'Unblock Contact' : 'Block Contact'}
                    </button>
                    <button onClick={() => { handleDownloadChat(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
                      <Download size={14} className="text-gray-400" /> Download Chat
                    </button>
                  </div>
                )}
              </div>

              {/* Close inline chat — always last */}
              {onClose && (
                <button
                  onClick={onClose}
                  title="Close chat"
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-gray-400 hover:text-teal-600 hover:bg-teal-50"
                >
                  <X size={15} />
                </button>
              )}
            </div>
        </div>

        {/* WhatsApp-style search panel — slides in below header */}
        {showSearch && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 animate-in slide-in-from-top-1 duration-200">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in conversation…"
              className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
              autoFocus
            />
            {searchQuery && (
              <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                {searchResultIds.length === 0 ? 'No results' : `${searchCurrentIdx + 1} of ${searchResultIds.length}`}
              </span>
            )}
            <button
              onClick={() => { if (searchResultIds.length) setSearchCurrentIdx((i) => (i - 1 + searchResultIds.length) % searchResultIds.length); }}
              disabled={!searchResultIds.length}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-teal-600 disabled:opacity-30 rounded-lg transition-colors"
            >
              <ChevronUp size={15} />
            </button>
            <button
              onClick={() => { if (searchResultIds.length) setSearchCurrentIdx((i) => (i + 1) % searchResultIds.length); }}
              disabled={!searchResultIds.length}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-teal-600 disabled:opacity-30 rounded-lg transition-colors"
            >
              <ChevronDown size={15} />
            </button>
            <button
              onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResultIds([]); }}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Messages area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Click-to-WhatsApp Ad banner */}
          {conversation.adSourceId && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex-shrink-0">
              {conversation.adImageUrl && (
                <img
                  src={conversation.adImageUrl}
                  alt="Ad"
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-blue-100"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide">From WhatsApp Ad</p>
                {conversation.adHeadline && (
                  <p className="text-xs text-blue-800 font-medium truncate">{conversation.adHeadline}</p>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col relative min-h-0">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 min-h-0" style={isDark ? { backgroundColor: '#1a202c' } : { backgroundImage: 'linear-gradient(rgba(255,255,255,0.65), rgba(255,255,255,0.65)), url(/chat-bg.jpg)', backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundColor: '#ece5dd' }}>
            {hasMoreOlder && (
              <div className="flex justify-center py-2">
                <button
                  onClick={loadOlderMessages}
                  disabled={loadingOlder}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-full hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingOlder
                    ? <><span className="animate-spin rounded-full h-3 w-3 border-b border-teal-600 inline-block" /> Loading…</>
                    : 'Load older messages'}
                </button>
              </div>
            )}
            {timeline.length === 0 ? (
              loading
                ? <div className="flex justify-center pt-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
                : <div className="text-center text-gray-400 text-sm mt-12">
                    {outboundSession ? 'Call in progress…' : 'Send a message to start the conversation.'}
                  </div>
            ) : (
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const entry = flatItems[virtualItem.index];
                  if (!entry) return null;
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                      className="pb-0.5"
                    >
                      {entry.kind === 'date-header' ? (
                        <div className="flex items-center justify-center my-3">
                          <span className="text-xs text-gray-500 dark:text-gray-400 bg-white/80 dark:bg-gray-700/80 px-3 py-1 rounded-full shadow-sm">{entry.label}</span>
                        </div>
                      ) : entry.kind === 'note' ? (
                        <NoteBubble note={entry.item} currentUserId={user?.id} onDelete={handleDeleteNote} onEdit={handleEditNote} />
                      ) : entry.kind === 'activity' ? (
                        <ActivityBubble entry={entry.item} />
                      ) : (
                        <MessageBubble
                          message={entry.item}
                          currentUserId={user?.id}
                          contactName={name}
                          conversationId={conversation.id}
                          onReply={(m) => setReplyTo({ id: m.id, content: m.content ?? undefined, type: m.type, direction: m.direction, mediaCaption: m.mediaCaption ?? undefined })}
                          onScrollToMessage={scrollToMessage}
                          searchQuery={showSearch ? searchQuery : ''}
                          isCurrentResult={showSearch && searchResultIds[searchCurrentIdx] === entry.item.id}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {typing.filter((id) => id !== user?.id).length > 0 && (
              <div className="flex items-end gap-2 pl-1 mt-1">
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', avatarColor)}>{getInitials(name)}</div>
                <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {newMsgCount > 0 && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
              <button
                onClick={() => { scrollToBottom(); setNewMsgCount(0); }}
                className="pointer-events-auto flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 text-white rounded-full shadow-lg text-xs font-semibold hover:bg-teal-700 transition-colors"
              >
                <ChevronDown size={13} />
                {newMsgCount} new message{newMsgCount > 1 ? 's' : ''}
              </button>
            </div>
          )}
          </div>

          {/* Input area */}
          <div className="border-t border-gray-100 dark:border-gray-700 px-4 pt-2 pb-3 flex-shrink-0 bg-white dark:bg-gray-900 relative">
            {/* Resolved banner */}
            {isResolved && (
              <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-200">
                <CheckCircle size={13} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-600 flex-1">
                  <span className="font-medium">Conversation resolved.</span>{' '}
                  {isExpiredResolved ? '24h session window has closed.' : 'Reopen to continue messaging.'}
                </span>
                <button
                  onClick={() => { void handleReopen(); }}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-900 px-2 py-0.5 rounded hover:bg-teal-100 flex-shrink-0"
                >
                  Reopen
                </button>
              </div>
            )}

            {/* Assigned-to-other gate — fully replaces input for active conversations */}
            {assignedToOther && !isResolved && localStatus !== 'ARCHIVED' && (
              <div className="flex items-center gap-3 py-3">
                {isVerzAssigned
                  ? (
                    <div className="w-9 h-9 rounded-full bg-violet-100 border-2 border-violet-200 flex items-center justify-center flex-shrink-0">
                      <Brain size={16} className="text-violet-600" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-orange-100 border-2 border-orange-200 flex items-center justify-center text-orange-700 text-sm font-bold flex-shrink-0 select-none">
                      {(conversation.assignedTo?.name ?? 'A').slice(0, 2).toUpperCase()}
                    </div>
                  )
                }
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 text-sm font-semibold leading-tight">
                    {isVerzAssigned ? 'Verz is handling this chat' : `${conversation.assignedTo?.name ?? 'Another agent'} is handling this chat`}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">Take over to reply, add notes, or resolve</p>
                </div>
                <button
                  onClick={() => { void handleTakeover(); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl transition-colors flex-shrink-0 shadow-sm"
                >
                  <UserPlus size={13} />
                  Take Over
                </button>
              </div>
            )}

            {/* Requesting banner — agent must intervene before typing */}
            {isRequested && !assignedToOther && inputMode === 'message' && (
              <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-orange-50 rounded-xl border border-orange-200">
                <AlertCircle size={13} className="text-orange-500 flex-shrink-0" />
                <span className="text-xs text-orange-700 flex-1">
                  <span className="font-medium">Customer has requested support</span> — click Intervene to start messaging.
                </span>
                <button
                  onClick={() => { void handleIntervene(); }}
                  className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 px-2 py-0.5 rounded hover:bg-indigo-100 flex-shrink-0"
                >
                  Intervene
                </button>
              </div>
            )}

            {/* Blocked contact banner */}
            {isBlocked && inputMode === 'message' && (
              <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-red-50 rounded-xl border border-red-200">
                <ShieldOff size={13} className="text-red-500 flex-shrink-0" />
                <span className="text-xs text-red-700 flex-1">
                  <span className="font-medium">This contact is blocked.</span> Unblock to send messages.
                </span>
              </div>
            )}

            {/* Session expired banner */}
            {sessionBlocked && !assignedToOther && inputMode === 'message' && (
              <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-200">
                <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs text-amber-700 flex-1">
                  <span className="font-medium">WhatsApp session has expired.</span> Send a template to re-engage.
                </span>
                <button
                  onClick={() => setShowTemplatePicker(true)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <MessageSquare size={11} />
                  Send Template
                </button>
              </div>
            )}

            {/* Reply preview */}
            {replyTo && (
              <div className="flex items-center gap-2 mb-1.5 px-3 py-1.5 bg-teal-50 border-l-2 border-teal-400 rounded-r-xl">
                <Reply size={12} className="text-teal-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-teal-700">{replyTo.direction === 'INBOUND' ? name : 'You'}</p>
                  <p className="text-xs text-gray-500 truncate">{replyTo.content ?? replyTo.mediaCaption ?? replyTo.type}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={12} /></button>
              </div>
            )}

            {/* Live location bar */}
            {liveLocation.active && (
              <div className="flex items-center justify-between px-1 pb-1.5">
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <MapPin size={12} />
                  <span>Sharing live location{liveLocation.expiresAt > Date.now() && <> · {Math.ceil((liveLocation.expiresAt - Date.now()) / 60000)} min</>}</span>
                </div>
                <button onClick={stopLiveLocation} className="text-xs font-medium text-red-600 hover:text-red-800 px-2 py-0.5 rounded hover:bg-red-50">Stop</button>
              </div>
            )}

            {/* Canned response picker */}
            {showCanned && (
              <CannedPicker
                query={cannedQuery}
                vars={cannedVars}
                onSelect={handleCannedSelect}
                onClose={() => setShowCanned(false)}
              />
            )}

            {/* AI Suggestion card */}
            {aiSuggestion && inputMode === 'message' && (
              <div className="mb-2 rounded-xl border border-teal-200 bg-teal-50 dark:bg-teal-900/20 dark:border-teal-700 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={14} className="text-teal-600" />
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">Verz AI Suggestion</span>
                    {aiSuggestion.confidence !== null && (
                      <span className={cn(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                        aiSuggestion.confidence >= 70
                          ? 'bg-green-100 text-green-700'
                          : 'bg-orange-100 text-orange-700'
                      )}>
                        {aiSuggestion.confidence}% confidence
                        {aiSuggestion.confidence < 70 && ' · Human Review Recommended'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      void aiLogsApi.updateStatus(aiSuggestion.logId, 'REJECTED').catch(() => null);
                      setAiSuggestion(null);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  ><X size={14} /></button>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200 mb-2 leading-snug">{aiSuggestion.response}</p>
                <div className="flex items-center gap-2">
                  <button
                    disabled={aiSuggestionSending}
                    onClick={async () => {
                      setAiSuggestionSending(true);
                      try {
                        const logId = aiSuggestion.logId;
                        const responseText = aiSuggestion.response;
                        await aiLogsApi.updateStatus(logId, 'APPROVED', responseText).catch(() => null);
                        setAiSuggestion(null);
                        await messagesApi.send(conversation.id, { content: responseText, type: 'TEXT' });
                        setAiFeedbackLogId(logId);
                      } catch { toast.error('Failed to send'); }
                      finally { setAiSuggestionSending(false); }
                    }}
                    className="flex items-center gap-1 text-xs font-medium bg-teal-600 text-white px-2.5 py-1 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    <Send size={11} /> Send as-is
                  </button>
                  <button
                    onClick={() => {
                      setText(aiSuggestion.response);
                      setAiSuggestion(null);
                      inputRef.current?.focus();
                    }}
                    className="flex items-center gap-1 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50"
                  >
                    <Pencil size={11} /> Edit &amp; Send
                  </button>
                  <button
                    onClick={() => { void navigator.clipboard.writeText(aiSuggestion.response).then(() => toast.success('Copied')).catch(() => null); }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-1.5 py-1"
                  >
                    <Copy size={11} /> Copy
                  </button>
                </div>
              </div>
            )}

            {/* Post-send feedback prompt */}
            {aiFeedbackLogId && (
              <div className="mb-2 rounded-xl border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ThumbsUp size={13} className="text-yellow-600" />
                  <span className="text-xs text-yellow-700 font-medium">Rate this AI suggestion:</span>
                  {[1,2,3,4,5].map((r) => (
                    <button key={r} onClick={() => {
                      const id = aiFeedbackLogId!;
                      setAiFeedbackLogId(null);
                      void aiLogsApi.feedback(id, r).catch(() => null);
                      toast.success('Thanks for the feedback!');
                    }} className="text-yellow-500 hover:text-yellow-600">
                      {'★'}
                    </button>
                  ))}
                </div>
                <button onClick={() => setAiFeedbackLogId(null)} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
              </div>
            )}

            {/* Mode tabs + input row — hidden while another agent owns this active chat */}
            {!(assignedToOther && !isResolved && localStatus !== 'ARCHIVED') && (<>
            <div className="flex items-center gap-1 mb-1.5">
              <button
                onClick={() => setInputMode('message')}
                className={cn('flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors', inputMode === 'message' ? 'bg-teal-100 text-teal-700' : 'text-gray-400 hover:text-gray-600')}
              >
                <MessageSquare size={11} /> Message
              </button>
              <button
                onClick={() => setInputMode('note')}
                className={cn('flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors', inputMode === 'note' ? 'bg-yellow-100 text-yellow-700' : 'text-gray-400 hover:text-gray-600')}
              >
                <NoteIcon size={11} /> Note
              </button>
              {inputMode === 'note' && <span className="text-xs text-yellow-600 ml-1">Private — customers can't see this</span>}
            </div>

            {/* Backdrop */}
            {(showAttachMenu || showEmojiPicker) && <div className="fixed inset-0 z-40" onClick={closeMenus} />}

            {/* Attachment popup */}
            {showAttachMenu && (
              <div className="fixed z-50 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden w-52" style={{ bottom: popupPos.bottom, left: popupPos.left }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { closeMenus(); fileInputRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700">
                  <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center"><FileText size={14} className="text-blue-600" /></div>Document / File
                </button>
                <button onClick={() => { closeMenus(); photoInputRef.current?.click(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700">
                  <div className="w-7 h-7 bg-teal-100 rounded-lg flex items-center justify-center"><ImageIcon size={14} className="text-teal-600" /></div>Photos &amp; Videos
                </button>
                <button onClick={() => { closeMenus(); setShowLocationPicker(true); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700">
                  <div className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center"><MapPin size={14} className="text-red-500" /></div>Location
                </button>
                <button onClick={() => { void openContactPicker(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700">
                  <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center"><User size={14} className="text-purple-600" /></div>Contact
                </button>
                <button onClick={() => { closeMenus(); setShowLibraryPicker(true); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700">
                  <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center"><Images size={14} className="text-violet-600" /></div>File Library
                </button>
              </div>
            )}

            {/* Emoji picker — portal avoids ancestor stacking context clipping */}
            {showEmojiPicker && createPortal(
              <div
                className="fixed z-[9999]"
                style={{ bottom: popupPos.bottom, left: popupPos.left }}
                onClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <EmojiPicker
                  onEmojiClick={(emojiData: { emoji: string }) => { setText((t) => t + emojiData.emoji); setShowEmojiPicker(false); }}
                  lazyLoadEmojis
                  searchPlaceholder="Search emoji…"
                  skinTonesDisabled
                  previewConfig={{ showPreview: false }}
                  height={380}
                  width={Math.min(352, typeof window !== 'undefined' ? window.innerWidth - 24 : 352)}
                />
              </div>,
              document.body
            )}

            {/* @mention dropdown */}
            {showMentions && inputMode === 'note' && (
              <div className="mb-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {teamMembers.filter((m) => (m.name ?? '').toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5).length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No team members found</p>
                ) : (
                  teamMembers.filter((m) => (m.name ?? '').toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5).map((m) => (
                    <button
                      key={m.id}
                      onMouseDown={(e) => { e.preventDefault(); selectMention(m); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-teal-50 text-left transition-colors"
                    >
                      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', getAvatarColor(m.name))}>
                        {getInitials(m.name)}
                      </div>
                      <span className="text-sm text-gray-800">{m.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{m.email}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Formatting toolbar */}
            {inputMode === 'message' && !recording && !inputDisabled && (
              <div className="flex items-center gap-0.5 mb-1.5 px-1">
                <button onMouseDown={(e) => { e.preventDefault(); applyFormat('*', '*'); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Bold (*text*)">
                  <Bold size={13} />
                </button>
                <button onMouseDown={(e) => { e.preventDefault(); applyFormat('_', '_'); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Italic (_text_)">
                  <Italic size={13} />
                </button>
                <button onMouseDown={(e) => { e.preventDefault(); applyFormat('~', '~'); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Strikethrough (~text~)">
                  <Strikethrough size={13} />
                </button>
                <button onMouseDown={(e) => { e.preventDefault(); applyFormat('__', '__'); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Underline (__text__)">
                  <Underline size={13} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.csv,image/*" multiple className="hidden" onChange={(e) => { void sendFile(e); }} />
              <input ref={photoInputRef} type="file" accept="image/*,.heic,.heif,video/*" multiple className="hidden" onChange={(e) => { void sendFile(e); }} />

              {/* Attach button — LEFT side, only in message mode */}
              {inputMode === 'message' && !recording && (
                <button
                  ref={attachBtnRef}
                  onClick={() => {
                    const rect = attachBtnRef.current?.getBoundingClientRect();
                    if (rect) setPopupPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
                    setShowEmojiPicker(false);
                    setShowAttachMenu((v) => !v);
                  }}
                  disabled={sendDisabled}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  <Paperclip size={16} />
                </button>
              )}

              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                spellCheck={true}
                onChange={(e) => { void handleTextChange(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowMentions(false); }
                  if (!showCanned && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
                }}
                placeholder={
                  savingNote ? 'Saving note…' :
                  sending ? 'Sending…' :
                  inputMode === 'note' ? 'Use @ to mention a team member…' :
                  isResolved ? 'Reopen conversation to send messages' :
                  isRequested ? 'Intervene to start messaging…' :
                  sessionBlocked ? 'Session expired — send a template to re-engage' :
                  'Send your message... (Shift+Enter for new line)'
                }
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors border resize-none overflow-y-hidden leading-snug',
                  inputMode === 'note'
                    ? 'bg-yellow-50 border-yellow-200 focus:ring-yellow-400 focus:bg-yellow-50'
                    : 'bg-gray-50 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 border-gray-100 focus:ring-teal-500 focus:bg-white dark:focus:bg-gray-700 focus:border-teal-300',
                  inputDisabled && 'opacity-60 cursor-not-allowed'
                )}
                disabled={inputDisabled}
              />

              {/* RIGHT side */}
              {recording ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={cancelRecording} className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-200"><X size={14} /></button>
                  <button onClick={stopRecording} className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center text-white hover:bg-red-600 animate-pulse"><Square size={13} fill="white" /></button>
                </div>
              ) : text.trim() ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Emoji button — RIGHT when typing */}
                  <button
                    ref={emojiBtnRef}
                    onClick={() => {
                      const rect = emojiBtnRef.current?.getBoundingClientRect();
                      if (rect) { const pickerW = Math.min(352, window.innerWidth - 24); setPopupPos({ left: Math.max(8, Math.min(rect.right - pickerW, window.innerWidth - pickerW - 8)), bottom: window.innerHeight - rect.top + 8 }); }
                      setShowAttachMenu(false);
                      setShowEmojiPicker((v) => !v);
                    }}
                    disabled={inputDisabled}
                    className="text-gray-400 hover:text-teal-600 transition-colors p-1.5 disabled:opacity-40 flex-shrink-0"
                  >
                    <Smile size={19} />
                  </button>
                  <button onClick={() => { void sendMessage(); }} disabled={sendDisabled} className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white disabled:opacity-50 hover:opacity-90 transition-colors flex-shrink-0', inputMode === 'note' ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-teal-600 hover:bg-teal-700')}>
                    <Send size={14} />
                  </button>
                </div>
              ) : inputMode === 'message' ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Emoji button — RIGHT when empty */}
                  <button
                    ref={emojiBtnRef}
                    onClick={() => {
                      const rect = emojiBtnRef.current?.getBoundingClientRect();
                      if (rect) { const pickerW = Math.min(352, window.innerWidth - 24); setPopupPos({ left: Math.max(8, Math.min(rect.right - pickerW, window.innerWidth - pickerW - 8)), bottom: window.innerHeight - rect.top + 8 }); }
                      setShowAttachMenu(false);
                      setShowEmojiPicker((v) => !v);
                    }}
                    disabled={inputDisabled}
                    className="text-gray-400 hover:text-teal-600 transition-colors p-1.5 disabled:opacity-40 flex-shrink-0"
                  >
                    <Smile size={19} />
                  </button>
                  <button onClick={() => { void startRecording(); }} disabled={sendDisabled} className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center text-white disabled:opacity-50 hover:bg-teal-700 transition-colors">
                    <Mic size={14} />
                  </button>
                </div>
              ) : (
                /* Note mode: emoji on right */
                <button
                  ref={emojiBtnRef}
                  onClick={() => {
                    const rect = emojiBtnRef.current?.getBoundingClientRect();
                    if (rect) { const pickerW = Math.min(352, window.innerWidth - 24); setPopupPos({ left: Math.max(8, Math.min(rect.right - pickerW, window.innerWidth - pickerW - 8)), bottom: window.innerHeight - rect.top + 8 }); }
                    setShowAttachMenu(false);
                    setShowEmojiPicker((v) => !v);
                  }}
                  disabled={inputDisabled}
                  className="text-gray-400 hover:text-teal-600 transition-colors p-1.5 disabled:opacity-40 flex-shrink-0"
                >
                  <Smile size={19} />
                </button>
              )}
            </div>
            </>)}
          </div>
        </div>

      </div>

      {/* Contact picker modal */}
      {showContactPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setShowContactPicker(false)}>
          <div className="bg-white w-full max-w-sm rounded-t-2xl p-4 max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-800">Send Contact</h4>
              <button onClick={() => setShowContactPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {contacts.map((c) => (
              <button key={c.id} onClick={() => { void sendContact(c); }} className="w-full flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg text-left">
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold', getAvatarColor(c.name ?? c.phone))}>{getInitials(c.name ?? c.phone)}</div>
                <div><p className="text-sm font-medium text-gray-800">{c.name ?? c.phone}</p><p className="text-xs text-gray-500">{c.phone}</p></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Location picker modal */}
      {showLocationPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowLocationPicker(false); setAddrQuery(''); setAddrResults([]); }}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2"><MapPin size={18} className="text-red-500" /><h4 className="font-semibold text-gray-900">Share Location</h4></div>
              <button onClick={() => { setShowLocationPicker(false); setAddrQuery(''); setAddrResults([]); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {/* Current location */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Current location</p>
                <button
                  onClick={() => {
                    setShowLocationPicker(false);
                    void sendCurrentPosition('Current Location').catch((e) => toast.error(e instanceof Error ? e.message : 'Location error'));
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-teal-50 hover:bg-teal-100 transition-colors text-sm font-semibold text-teal-700"
                >
                  <MapPin size={15} className="flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-semibold text-sm">Send current location</p>
                    <p className="text-xs text-teal-500 font-normal">Sends a one-time GPS pin</p>
                  </div>
                </button>
              </div>
              <div className="h-px bg-gray-100" />
              {/* Specific location */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Specific location</p>
                <div className="flex gap-2">
                  <input
                    value={addrQuery}
                    onChange={(e) => setAddrQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void searchAddress(); }}
                    placeholder="Search address or place…"
                    className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <button
                    onClick={() => void searchAddress()}
                    disabled={addrSearching || !addrQuery.trim()}
                    className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {addrSearching ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin block" /> : 'Search'}
                  </button>
                </div>
                {addrResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-44 overflow-y-auto">
                    {addrResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => void sendSpecificAddress(r.lat, r.lon, r.display_name.split(',')[0])}
                        className="w-full flex items-start gap-2 px-3 py-2 rounded-xl hover:bg-teal-50 text-left transition-colors"
                      >
                        <MapPin size={13} className="flex-shrink-0 text-teal-500 mt-0.5" />
                        <span className="text-xs text-gray-700 line-clamp-2">{r.display_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="h-px bg-gray-100" />
              {/* Live location */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Live location</p>
                <div className="space-y-1.5">
                  {LOCATION_DURATIONS.map(({ label, minutes }) => (
                    <button key={minutes} onClick={() => { setShowLocationPicker(false); void startLiveLocation(minutes); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 hover:bg-teal-50 hover:text-teal-700 transition-colors text-sm font-medium text-gray-700">
                      <MapPin size={15} className="flex-shrink-0 opacity-50" />
                      <div className="text-left">
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-xs text-gray-400 font-normal">Updates your location in real time</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template picker (session expired) */}
      {showTemplatePicker && (
        <TemplatePicker
          onClose={() => setShowTemplatePicker(false)}
          onSend={async (templateId, variables) => {
            try {
              await messagesApi.send(conversation.id, { type: 'TEMPLATE', templateId, templateVariables: Object.keys(variables).length > 0 ? variables : undefined });
            } catch (err) { toast.error(getApiError(err, 'Failed to send template')); }
            setShowTemplatePicker(false);
          }}
        />
      )}

      {/* File Library picker */}
      {showLibraryPicker && (
        <LibraryPickerModal
          onClose={() => setShowLibraryPicker(false)}
          onSend={async (items) => {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const cap = (item.type === 'IMAGE' || item.type === 'VIDEO') ? null : (item.mediaCaption ?? null);
              const tempId = `temp-lib-${Date.now()}-${i}`;
              addMessage(conversation.id, {
                id: tempId, content: null, type: item.type, status: 'QUEUED' as MessageStatus,
                direction: MessageDirection.OUTBOUND,
                createdAt: new Date().toISOString(), conversationId: conversation.id,
                tenantId: '', contactId: '', senderId: null, whatsappMessageId: null,
                mediaUrl: item.mediaUrl, mediaType: null, mediaSize: null, mediaCaption: cap,
                templateId: null, templateVariables: null, metadata: null,
                sentAt: null, deliveredAt: null, readAt: null, failedAt: null, failureReason: null,
                replyToId: null, isStarred: false, isPinned: false, isEdited: false,
                editedAt: null, deletedForEveryone: false, deletedAt: null,
              } as unknown as Message);
              try {
                const res = await messagesApi.send(conversation.id, { type: item.type, mediaUrl: item.mediaUrl, ...(cap ? { mediaCaption: cap } : {}) });
                const real = res.data as Message;
                removeMessage(conversation.id, tempId);
                if (real?.id) addMessage(conversation.id, real);
              } catch (err) {
                removeMessage(conversation.id, tempId);
                toast.error(getApiError(err, 'Failed to send item'));
              }
            }
          }}
        />
      )}

      {/* Transfer modal */}
      {showTransfer && (
        <TransferModal
          teamMembers={teamMembers}
          transferring={transferring}
          assignedToId={conversation.assignedTo?.id}
          onTransfer={handleTransfer}
          onClose={() => setShowTransfer(false)}
        />
      )}

    </div>
  );
}

// ─── Link renderer ────────────────────────────────────────────────────────────

// Single-pass: WhatsApp format markers + URLs, no backreferences, no recursion.
// Character-class exclusions ([^*\n]+) prevent catastrophic backtracking.
// __ must appear before _ in the alternation so underline wins over italic.
const RENDER_RE = /__([^_\n]+)__|~([^~\n]+)~|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

function renderWithLinks(text: string, isOutbound: boolean): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  RENDER_RE.lastIndex = 0;
  while ((match = RENDER_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined)      parts.push(<u key={match.index}>{match[1]}</u>);
    else if (match[2] !== undefined) parts.push(<del key={match.index}>{match[2]}</del>);
    else if (match[3] !== undefined) parts.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4] !== undefined) parts.push(<em key={match.index}>{match[4]}</em>);
    else parts.push(
      <a key={match.index} href={match[5]} target="_blank" rel="noopener noreferrer"
        className={cn('underline break-all', isOutbound ? 'text-teal-100 hover:text-white' : 'text-teal-600 hover:text-teal-700')}
        onClick={(e) => e.stopPropagation()}
      >{match[5]}</a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

// ─── Note Bubble ──────────────────────────────────────────────────────────────

const NoteBubble = memo(function NoteBubble({
  note,
  currentUserId,
  onDelete,
  onEdit,
}: {
  note: { id: string; content: string; createdAt: string; author: { id: string; name: string } };
  currentUserId?: string;
  onDelete?: (noteId: string) => void;
  onEdit?: (noteId: string, content: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const isOwn = currentUserId === note.author.id;

  const handleSave = async () => {
    if (!editContent.trim() || !onEdit) return;
    setSaving(true);
    await onEdit(note.id, editContent.trim());
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="flex justify-center px-1 py-1">
      <div className="max-w-xs lg:max-w-md w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-1.5 mb-1">
          <StickyNote size={11} className="text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">Internal Note</span>
          <span className="text-xs text-amber-500 ml-1">· {note.author.name}</span>
          {isOwn && !editing && (
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => { setEditing(true); setEditContent(note.content); }} className="text-amber-400 hover:text-amber-600 p-0.5 rounded transition-colors" title="Edit note">
                <Pencil size={10} />
              </button>
              <button onClick={() => onDelete?.(note.id)} className="text-amber-400 hover:text-red-500 p-0.5 rounded transition-colors" title="Delete note">
                <Trash2 size={10} />
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full text-sm text-gray-800 bg-white border border-amber-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded transition-colors">Cancel</button>
              <button onClick={() => { void handleSave(); }} disabled={saving || !editContent.trim()}
                className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{note.content}</p>
        )}
        <p className="text-xs text-amber-400 mt-1 text-right">
          {new Date(note.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
});

// ─── Activity Bubble ──────────────────────────────────────────────────────────

const ACTIVITY_LABELS: Record<string, (who: string, meta: Record<string, unknown>) => { text: string; color: string }> = {
  CONVERSATION_CREATED:      (who) => ({ text: `${who} started this conversation`, color: 'text-teal-600' }),
  CONVERSATION_RESOLVED:     (who) => ({ text: `${who} resolved this conversation`, color: 'text-green-600' }),
  CONVERSATION_REOPENED:     (who) => ({ text: `${who} reopened this conversation`, color: 'text-blue-600' }),
  CONVERSATION_ARCHIVED:     (who) => ({ text: `${who} archived this conversation`, color: 'text-gray-500' }),
  CONVERSATION_REQUESTED:    ()    => ({ text: 'Customer requested human support', color: 'text-orange-600' }),
  CONVERSATION_INTERVENED:   (who) => ({ text: `${who} intervened and took over`, color: 'text-indigo-600' }),
  CONVERSATION_TRANSFERRED:  (who, m) => ({
    text: m.toAgentName
      ? `${m.fromAgentName ? String(m.fromAgentName) : who} transferred to ${String(m.toAgentName)}`
      : `${m.fromAgentName ? String(m.fromAgentName) : who} transferred this conversation`,
    color: 'text-purple-600',
  }),
  CONVERSATION_ASSIGNED:     (who) => ({ text: `${who} assigned this conversation`, color: 'text-purple-600' }),
  CONVERSATION_UNASSIGNED:   (who) => ({ text: `${who} unassigned this conversation`, color: 'text-gray-500' }),
  NOTE_ADDED:                (who) => ({ text: `${who} added an internal note`, color: 'text-amber-600' }),
  TAG_ADDED:                 (who, m) => ({ text: `${who} added tag "${String(m.label ?? m.name ?? '')}"`, color: 'text-teal-600' }),
  TAG_REMOVED:               (who, m) => ({ text: `${who} removed tag "${String(m.label ?? m.name ?? '')}"`, color: 'text-gray-500' }),
  MESSAGE_EDITED:            (who) => ({ text: `${who} edited a message`, color: 'text-gray-400' }),
  CONTACT_UPDATED:           (who) => ({ text: `${who} updated contact info`, color: 'text-gray-500' }),
  CONTACT_BLOCKED:           (who) => ({ text: `${who} blocked this contact`, color: 'text-red-500' }),

};

function formatCallDuration(secs: number): string {
  if (secs <= 0) return '';
  if (secs < 60) return `${secs} sec`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m} min ${s} sec` : `${m} min`;
}

const ActivityBubble = memo(function ActivityBubble({ entry }: { entry: ActivityEntry }) {
  const who = entry.user?.name ?? 'System';
  const labelFn = ACTIVITY_LABELS[entry.action];
  const { text, color } = labelFn
    ? labelFn(who, entry.metadata)
    : { text: `${who} ${entry.action.toLowerCase().replace(/_/g, ' ')}`, color: 'text-gray-500' };

  const time = new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // Call ended / missed — WhatsApp-style call bubble
  if (entry.action === 'CALL_ENDED' || entry.action === 'CALL_MISSED') {
    const { direction, status, duration, recordingUrl } = entry.metadata as { direction: string; status: string; duration: number; recordingUrl?: string | null };
    const isOutbound = direction === 'OUTBOUND';
    const isMissed = entry.action === 'CALL_MISSED' || status === 'MISSED' || status === 'FAILED';
    const durationLabel = formatCallDuration(duration ?? 0);
    const IconEl = isMissed ? PhoneMissed : isOutbound ? PhoneOutgoing : PhoneIncoming;
    return (
      <div className={cn('flex px-4 py-1', isOutbound ? 'justify-end' : 'justify-start')}>
        <div className={cn(
          'flex flex-col gap-2 rounded-2xl px-4 py-3 shadow-sm min-w-[180px]',
          isMissed
            ? 'bg-red-50 border border-red-100'
            : 'bg-white border border-gray-200',
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              isMissed ? 'bg-red-100' : 'bg-emerald-100',
            )}>
              <IconEl size={16} className={isMissed ? 'text-red-500' : 'text-emerald-600'} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-semibold', isMissed ? 'text-red-600' : 'text-gray-900')}>
                {isMissed ? 'Missed voice call' : 'Voice call'}
              </p>
              {durationLabel && <p className="text-xs text-gray-400">{durationLabel}</p>}
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0 ml-1">{time}</span>
          </div>
          {recordingUrl && (
            <audio
              controls
              className="w-full h-8 [&::-webkit-media-controls-panel]:bg-emerald-50 [&::-webkit-media-controls-timeline]:accent-emerald-600"
              style={{ minWidth: 200 }}
            >
              <source src={recordingUrl} />
              Your browser does not support audio playback.
            </audio>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center px-4 py-1.5">
      <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-full px-3.5 py-1 shadow-sm max-w-lg">
        <span className={cn('text-xs font-medium', color)}>{text}</span>
        <span className="text-gray-200 dark:text-gray-600 text-xs">·</span>
        <span className="text-xs text-gray-400 flex-shrink-0">{time}</span>
      </div>
    </div>
  );
});

// ─── Transfer Modal ────────────────────────────────────────────────────────────

function TransferModal({ teamMembers, transferring, assignedToId, onTransfer, onClose }: {
  teamMembers: { id: string; name: string; email: string }[];
  transferring: boolean;
  assignedToId?: string;
  onTransfer: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = teamMembers.filter((m) =>
    (m.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (m.email ?? '').toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-80 shadow-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><UserPlus size={16} className="text-teal-600" /><h4 className="font-semibold text-gray-900">Transfer Conversation</h4></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            type="text"
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="overflow-y-auto space-y-1 flex-1">
          {teamMembers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading team members...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No members found</p>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                disabled={transferring}
                onClick={() => onTransfer(m.id, m.name)}
                className="w-full flex items-center gap-3 p-2.5 hover:bg-teal-50 rounded-xl text-left transition-colors disabled:opacity-50"
              >
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold', getAvatarColor(m.name))}>{getInitials(m.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.name}</p>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>
                {assignedToId === m.id && <span className="text-xs text-teal-600 font-medium">Assigned</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Forward Modal ─────────────────────────────────────────────────────────────

function ForwardModal({ message, conversations, onClose }: {
  message: Message;
  conversations: { id: string; contact: { name: string | null; phone: string } }[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [forwarding, setForwarding] = useState<string | null>(null);

  const filtered = conversations.filter((c) => {
    if (!c.contact) return false;
    const name = c.contact.name ?? c.contact.phone;
    return name.toLowerCase().includes(search.toLowerCase()) || c.contact.phone.includes(search);
  });

  const forward = async (targetConvId: string) => {
    setForwarding(targetConvId);
    try {
      if (message.content) {
        await messagesApi.send(targetConvId, { type: 'TEXT', content: message.content });
      } else if (message.mediaUrl) {
        await messagesApi.send(targetConvId, { type: message.type, mediaUrl: message.mediaUrl, mediaCaption: message.mediaCaption ?? undefined });
      }
      toast.success('Message forwarded');
      onClose();
    } catch (err) { toast.error(getApiError(err, 'Failed to forward message')); }
    finally { setForwarding(null); }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Forward size={16} className="text-teal-600" />
            <h4 className="font-semibold text-gray-900 text-sm">Forward message</h4>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2 text-xs text-gray-500 border border-gray-200 mb-3">
            <Forward size={11} className="text-gray-400 flex-shrink-0" />
            <span className="truncate italic">{message.content ?? (message.mediaCaption ?? `[${message.type}]`)}</span>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus type="text" placeholder="Search conversations…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No other conversations</p>
          ) : filtered.map((c) => {
            const name = c.contact.name ?? c.contact.phone;
            return (
              <button key={c.id} onClick={() => { void forward(c.id); }} disabled={!!forwarding}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-teal-50 rounded-xl text-left transition-colors disabled:opacity-50">
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', 'bg-teal-100 text-teal-700')}>
                  {getInitials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                  <p className="text-xs text-gray-400">{c.contact.phone}</p>
                </div>
                {forwarding === c.id && <div className="w-4 h-4 border-2 border-teal-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

interface ContextMenu {
  x: number;
  y: number;
  messageId: string;
  adjusted?: boolean;
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query.trim())})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase()
      ? <mark key={i} className="bg-yellow-300 text-gray-900 rounded-[2px] px-[1px]">{part}</mark>
      : part,
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  currentUserId,
  contactName,
  conversationId,
  onReply,
  onScrollToMessage,
  searchQuery,
  isCurrentResult,
}: {
  message: Message;
  currentUserId?: string;
  contactName: string;
  conversationId: string;
  onReply?: (msg: Message) => void;
  onScrollToMessage?: (msgId: string) => void;
  searchQuery?: string;
  isCurrentResult?: boolean;
}) {
  const isOutbound = message.direction === MessageDirection.OUTBOUND;
  const isVerzAi = isOutbound && !!(message as unknown as { metadata?: Record<string, unknown> }).metadata?.aiGenerated;
  const avatarColor = getAvatarColor(contactName);
  const { updateMessage, conversations } = useInboxStore();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [starred, setStarred] = useState(message.isStarred ?? false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showForward, setShowForward] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved = useRef(false);

  useEffect(() => {
    if (!contextMenu) return;
    let handler: (e: MouseEvent) => void;
    // Delay by one tick so the right-click event that opened the menu doesn't immediately close it
    const timer = setTimeout(() => {
      handler = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
      };
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => { clearTimeout(timer); if (handler) document.removeEventListener('mousedown', handler); };
  }, [contextMenu]);

  // Measure actual menu height after render and clamp within viewport
  useLayoutEffect(() => {
    if (!contextMenu || contextMenu.adjusted || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 8;
    let { x, y } = contextMenu;
    if (x + rect.width > window.innerWidth - padding) x = window.innerWidth - rect.width - padding;
    x = Math.max(padding, x);
    if (y + rect.height > window.innerHeight - padding) y = y - rect.height;
    y = Math.max(padding, y);
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu(c => c ? { ...c, x, y, adjusted: true } : null);
    }
  }, [contextMenu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, messageId: message.id });
  };

  const handleCopy = () => {
    const selected = window.getSelection()?.toString().trim();
    const textToCopy = selected || message.content || '';
    if (textToCopy) {
      void navigator.clipboard.writeText(textToCopy).then(() => toast.success('Copied'));
    }
    setContextMenu(null);
  };

  const handleReply = () => { onReply?.(message); setContextMenu(null); };

  const handleForward = () => {
    setContextMenu(null);
    setShowForward(true);
  };

  const handleStar = async () => {
    setContextMenu(null);
    try {
      await messagesApi.star(conversationId, message.id);
      setStarred((v) => !v);
    } catch (err) { toast.error(getApiError(err, 'Failed to star message')); }
  };

  const handlePin = async () => {
    setContextMenu(null);
    try {
      await messagesApi.pin(conversationId, message.id);
      toast.success(message.isPinned ? 'Unpinned' : 'Pinned');
    } catch (err) { toast.error(getApiError(err, 'Failed to pin message')); }
  };

  const openContextMenuFromTouch = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setContextMenu({ x: touch.clientX, y: touch.clientY, messageId: message.id });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        openContextMenuFromTouch(e);
      }
    }, 500);
  };

  const handleTouchMove = () => {
    touchMoved.current = true;
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleReact = async (emoji: string) => {
    setContextMenu(null);
    const typed = message as Message & { messageReactions?: Array<{ emoji: string; userId: string | null }> };
    const alreadyReacted = typed.messageReactions?.some(r => r.userId === currentUserId && r.emoji === emoji);
    try {
      if (alreadyReacted) {
        await messagesApi.removeReact(conversationId, message.id, emoji);
      } else {
        await messagesApi.react(conversationId, message.id, emoji);
      }
    } catch (err) { toast.error(getApiError(err, 'Failed to send reaction')); }
  };

  return (
    <>
      <div
        id={`msg-${message.id}`}
        className={cn(
          'flex items-end gap-2 group px-1 py-0.5',
          isOutbound ? 'justify-end' : 'justify-start',
          isCurrentResult && 'ring-2 ring-yellow-400 ring-offset-2 rounded-2xl bg-yellow-50/60',
        )}
      >
        {!isOutbound && (
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 mb-5', avatarColor)}>
            {getInitials(contactName)}
          </div>
        )}
        {isVerzAi && (
          <div className="order-last w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mb-5" title="Verz AI">
            <Brain size={14} className="text-white" />
          </div>
        )}

        <div className={cn('flex items-end gap-1 max-w-[80vw] sm:max-w-xs lg:max-w-md', isOutbound ? 'flex-row-reverse' : 'flex-row')}>
          {/* Hover chevron button to open context menu */}
          <button
            onClick={openMenu}
            className={cn(
              'flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity mb-5',
              isOutbound ? 'order-first' : 'order-last',
            )}
          >
            <ChevronDown size={14} className="text-gray-500" />
          </button>
          <div className="flex flex-col gap-0.5">
            {/* Reply-to quote */}
            {message.replyTo && (
              <div
                className={cn(
                  'rounded-xl px-3 py-1.5 mb-0.5 border-l-3 cursor-pointer hover:opacity-80 transition-opacity',
                  isOutbound ? 'bg-teal-600/80 border-teal-300' : 'bg-gray-200 border-teal-500',
                )}
                onClick={() => onScrollToMessage?.(message.replyTo!.id)}
              >
                <p className={cn('text-xs font-semibold', isOutbound ? 'text-teal-200' : 'text-teal-600')}>
                  {message.replyTo.direction === 'INBOUND' ? contactName : 'You'}
                </p>
                <p className={cn('text-xs truncate italic', isOutbound ? 'text-teal-100' : 'text-gray-600')}>
                  {message.replyTo.content ?? message.replyTo.mediaCaption ?? '📎 Media'}
                </p>
              </div>
            )}

            {/* Main bubble */}
            <div
              className={cn(
                'rounded-2xl px-3 py-2',
                message.type === 'STICKER'
                  ? 'bg-transparent p-1'
                  : isOutbound
                  ? 'bg-teal-700 text-white rounded-br-sm'
                  : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-sm shadow-sm',
              )}
              onContextMenu={openMenu}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Forwarded indicator */}
              {!!(message as unknown as { metadata?: Record<string, unknown> | null }).metadata?.isForwarded && (
                <div className={cn('flex items-center gap-1 mb-1 opacity-70', isOutbound ? 'text-teal-200' : 'text-gray-400')}>
                  <Forward size={10} />
                  <span className="text-xs italic">Forwarded</span>
                </div>
              )}
              {/* Pin indicator */}
              {message.isPinned && (
                <div className="flex items-center gap-1 mb-1 opacity-60">
                  <Pin size={10} className={isOutbound ? 'text-teal-200' : 'text-gray-400'} />
                  <span className="text-xs">Pinned</span>
                </div>
              )}

              {message.content ? (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {searchQuery ? highlightText(message.content, searchQuery) : renderWithLinks(message.content, isOutbound)}
                  </p>
                  {message.type === 'TEXT' && (() => {
                    const url = extractFirstUrl(message.content);
                    return url ? <LinkPreview url={url} isOutbound={isOutbound} /> : null;
                  })()}
                </>
              ) : message.type === 'TEMPLATE' ? (
                <p className={cn('text-sm italic', isOutbound ? 'text-teal-200' : 'text-gray-400')}>📋 Template message</p>
              ) : !message.mediaUrl ? (
                <p className={cn('text-sm italic', isOutbound ? 'text-teal-200' : 'text-gray-400')}>📎 Unsupported message</p>
              ) : null}

              {message.type === 'LOCATION' && (
                <a href={`https://maps.google.com/?q=${message.metadata?.['latitude']},${message.metadata?.['longitude']}`} target="_blank" rel="noopener noreferrer"
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium mt-1', isOutbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700')}>
                  <MapPin size={14} /> {(message.metadata?.['name'] as string) || 'View location'}
                </a>
              )}

              {message.type === 'CONTACTS' && (
                <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs mt-1', isOutbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700')}>
                  <div className={cn('w-7 h-7 rounded-full flex items-center justify-center', isOutbound ? 'bg-teal-600' : 'bg-teal-100 text-teal-700')}><User size={14} /></div>
                  <div><p className="font-semibold">{(message.metadata?.['contactName'] as string) || 'Contact'}</p><p className="opacity-75">{message.metadata?.['contactPhone'] as string}</p></div>
                </div>
              )}

              {message.mediaUrl && (() => {
                const proxied = getProxiedMediaUrl(message.mediaUrl);
                const isUploading = message.status === 'QUEUED' && message.id.startsWith('temp-');
                return (
                  <div className="mt-1">
                    {message.type === 'IMAGE' && (
                      <button onClick={() => !isUploading && setLightboxSrc(proxied)} className="block group relative">
                        <img
                          src={proxied}
                          alt={message.mediaCaption ?? 'Image'}
                          className={cn('rounded-xl transition-opacity block w-full max-w-[238px] h-[150px] object-cover', isUploading ? 'opacity-60 cursor-default' : 'cursor-zoom-in hover:opacity-90')}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          onContextMenu={(e) => e.preventDefault()}
                        />
                        {isUploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </button>
                    )}
                    {message.type === 'VIDEO' && (
                      <div className="relative rounded-xl overflow-hidden max-w-full" style={{ maxWidth: '320px' }}>
                        <video controls={!isUploading} className="rounded-xl w-full" preload="metadata" style={{ maxWidth: '320px', maxHeight: '260px' }}>
                          <source src={proxied} />
                        </video>
                        {isUploading && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-xl gap-2">
                            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span className="text-white text-xs font-medium">Uploading…</span>
                          </div>
                        )}
                        {!isUploading && (
                          <a href={proxied} download={getDownloadFilename(message.mediaCaption, proxied)} title="Download video"
                            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors">
                            <Download size={13} />
                          </a>
                        )}
                      </div>
                    )}
                    {message.type === 'AUDIO' && (
                      <div className="flex items-center gap-2 mt-1 max-w-[224px]">
                        <audio controls className="w-full flex-1 min-w-0"><source src={proxied} /></audio>
                        <a href={proxied} download={getDownloadFilename(message.mediaCaption, proxied)} title="Download audio"
                          className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors', isOutbound ? 'text-teal-100 hover:bg-teal-800' : 'text-gray-500 hover:bg-gray-100')}>
                          <Download size={12} />
                        </a>
                      </div>
                    )}
                    {message.type === 'DOCUMENT' && (
                      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium mt-1', isOutbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700')}>
                        {isUploading
                          ? <><div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0" /><span>{message.mediaCaption ?? 'Uploading…'}</span></>
                          : <a href={proxied} download={getDownloadFilename(message.mediaCaption, proxied)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-80"><FileText size={14} /><span>{message.mediaCaption ?? 'Download document'}</span></a>
                        }
                      </div>
                    )}
                    {message.type === 'STICKER' && (
                      <img
                        src={proxied}
                        alt="Sticker"
                        className="w-24 h-24 object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    {message.mediaCaption && message.type !== 'DOCUMENT' && message.type !== 'VIDEO' && message.type !== 'STICKER' && (
                      <p className={cn('text-xs mt-1', isOutbound ? 'text-teal-200' : 'text-gray-500')}>{message.mediaCaption}</p>
                    )}
                  </div>
                );
              })()}
              {/* Timestamp + status — inside the bubble */}
              <div className={cn('flex items-center gap-1 mt-1', isOutbound ? 'justify-end' : 'justify-start')}>
                {starred && <Star size={9} className="text-yellow-300 fill-yellow-300" />}
                <span className={cn('text-[10px]', isOutbound ? 'text-white/60' : 'text-gray-400')}>{formatMessageTime(message.createdAt)}</span>
                {isOutbound && (
                  <span title={
                    message.status === MessageStatus.READ ? `Read ${fmtTimestamp(message.readAt) ?? ''}` :
                    message.status === MessageStatus.DELIVERED ? `Delivered ${fmtTimestamp(message.deliveredAt) ?? ''}` :
                    message.status === MessageStatus.SENT ? `Sent ${fmtTimestamp(message.sentAt) ?? ''}` :
                    message.status === MessageStatus.FAILED ? 'Failed to deliver' : ''
                  }>
                    {STATUS_ICONS[message.status] ?? null}
                  </span>
                )}
                {message.status === MessageStatus.FAILED && (
                  <span className="text-[10px] text-red-300">Failed</span>
                )}
              </div>
            </div>

            {/* Reaction pills */}
            {(() => {
              const typed = message as Message & { messageReactions?: Array<{ id: string; emoji: string; userId: string | null }> };
              const reactions = typed.messageReactions ?? [];
              if (reactions.length === 0) return null;
              const grouped = reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
                if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
                acc[r.emoji].count++;
                if (r.userId === currentUserId) acc[r.emoji].mine = true;
                return acc;
              }, {});
              return (
                <div className={cn('flex flex-wrap gap-1 px-1 -mt-0.5 mb-0.5', isOutbound ? 'justify-end' : 'justify-start')}>
                  {Object.entries(grouped).map(([emoji, { count, mine }]) => (
                    <button
                      key={emoji}
                      onClick={() => { void handleReact(emoji); }}
                      className={cn(
                        'inline-flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 border transition-colors',
                        mine
                          ? 'bg-teal-100 border-teal-300 text-teal-700'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-teal-300',
                      )}
                    >
                      <span>{emoji}</span>
                      {count > 1 && <span className="font-medium">{count}</span>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Verz AI sender label */}
            {isVerzAi && (
              <div className="flex items-center justify-end gap-1 px-1 -mt-0.5 mb-0.5">
                <Brain size={10} className="text-violet-500" />
                <span className="text-[10px] text-violet-500 font-medium">Verz · AI</span>
              </div>
            )}

            {/* Info toggle — outside bubble, hover-only */}
            <div className={cn('flex px-1', isOutbound ? 'justify-end' : 'justify-start')}>
              <button onClick={() => setShowInfo((v) => !v)} className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity">
                <Info size={10} className="text-gray-400" />
              </button>
            </div>

            {/* Info expanded (full delivery details) */}
            {showInfo && (
              <div className={cn('text-xs rounded-xl px-3 py-2 space-y-0.5 mt-0.5', isOutbound ? 'bg-teal-50 text-teal-800' : 'bg-gray-50 text-gray-600')}>
                {message.sentAt && <p>Sent: {new Date(message.sentAt).toLocaleString()}</p>}
                {message.deliveredAt && <p>Delivered: {new Date(message.deliveredAt).toLocaleString()}</p>}
                {message.readAt && <p>Read: {new Date(message.readAt).toLocaleString()}</p>}
                {message.failedAt && <p className="text-red-500">Failed: {new Date(message.failedAt).toLocaleString()}</p>}
                {message.failureReason && <p className="text-red-500 text-xs">{message.failureReason}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Forward modal */}
      {showForward && (
        <ForwardModal
          message={message}
          conversations={conversations.filter((c) => c.id !== conversationId)}
          onClose={() => setShowForward(false)}
        />
      )}

      {/* Image lightbox — portalled to body to escape virtualizer transform stacking context */}
      {lightboxSrc && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center" onClick={() => setLightboxSrc(null)}>
          <button className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors" onClick={() => setLightboxSrc(null)}>
            <X size={20} />
          </button>
          <img src={lightboxSrc} alt="Full size" className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain" onClick={(e) => e.stopPropagation()} />
          <a href={lightboxSrc} download={getDownloadFilename(undefined, lightboxSrc)} target="_blank" rel="noopener noreferrer" className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl transition-colors" onClick={(e) => e.stopPropagation()}>
            <Download size={13} /> Download
          </a>
        </div>,
        document.body,
      )}

      {/* Context menu — portalled to body to escape virtualizer transform stacking context */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9998] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden py-1.5 w-52"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick reactions row */}
          <div className="flex items-center justify-around px-3 py-2 border-b border-gray-100">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} onClick={() => { void handleReact(emoji); }} className="text-xl hover:scale-125 transition-transform">{emoji}</button>
            ))}
          </div>
          <button onClick={handleReply} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
            <Reply size={14} className="text-gray-400" /> Reply
          </button>
          {message.content && (
            <button onClick={handleCopy} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
              <Copy size={14} className="text-gray-400" /> Copy
            </button>
          )}
          <button onClick={handleForward} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
            <Forward size={14} className="text-gray-400" /> Forward
          </button>
          <button onClick={() => { void handleStar(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
            <Star size={14} className={starred ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'} /> {starred ? 'Unstar' : 'Star'}
          </button>
          <button onClick={() => { void handlePin(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
            <Pin size={14} className="text-gray-400" /> {message.isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={() => { setShowInfo((v) => !v); setContextMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
            <Info size={14} className="text-gray-400" /> Message info
          </button>
        </div>,
        document.body,
      )}
    </>
  );
});

interface Template { id: string; name: string; language: string; status: string; category: string; components?: Array<{ type: string; text?: string }>; }

function extractVarIndices(components: Array<{ type: string; text?: string }>): string[] {
  const indices = new Set<string>();
  for (const c of components) {
    const matches = c.text?.match(/\{\{(\d+)\}\}/g) ?? [];
    for (const m of matches) indices.add(m.replace(/[{}]/g, ''));
  }
  return [...indices].sort((a, b) => +a - +b);
}

function TemplatePicker({ onClose, onSend }: { onClose: () => void; onSend: (templateId: string, variables: Record<string, string>) => Promise<void> }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    templatesApi.list({ status: 'APPROVED', limit: 100 }).then((res) => {
      setTemplates((res.data as { items?: Template[]; data?: Template[] }).items ?? (res.data as { items?: Template[]; data?: Template[] }).data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!loading) setTimeout(() => searchRef.current?.focus(), 50);
  }, [loading]);

  const filtered = useMemo(() => {
    if (!query.trim()) return templates;
    const q = query.toLowerCase();
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [templates, query]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-teal-600" />
            <h2 className="font-semibold text-gray-900">Send Template</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {selectedTemplate ? (
          <>
            <div className="px-4 pt-3 pb-2">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 mb-3"
              >
                <ChevronLeft size={13} /> Back
              </button>
              <p className="font-medium text-gray-900 text-sm">{selectedTemplate.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{selectedTemplate.language} · {selectedTemplate.category}</p>
            </div>
            <div className="max-h-[52vh] overflow-y-auto px-4 pb-4">
              <div className="space-y-3 mt-1">
                {Object.keys(variables).map((key) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Variable {`{{${key}}}`}</label>
                    <input
                      type="text"
                      value={variables[key]}
                      onChange={(e) => setVariables((v) => ({ ...v, [key]: e.target.value }))}
                      placeholder={`Enter value for {{${key}}}`}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
              <button
                disabled={Object.values(variables).some((v) => !v.trim()) || !!sending}
                onClick={async () => {
                  setSending(selectedTemplate.id);
                  await onSend(selectedTemplate.id, variables);
                  setSending(null);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition-colors disabled:opacity-50"
              >
                {sending ? <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> : <Send size={13} />}
                Send
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100">
                <Search size={13} className="text-gray-400 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search templates…"
                  className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[52vh] overflow-y-auto px-4 pb-4">
              {loading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">
                  {query ? 'No templates match your search' : 'No approved templates found'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((t) => (
                    <button
                      key={t.id}
                      disabled={!!sending}
                      onClick={async () => {
                        const varIndices = extractVarIndices(t.components ?? []);
                        if (varIndices.length === 0) {
                          setSending(t.id);
                          await onSend(t.id, {});
                          setSending(null);
                        } else {
                          setSelectedTemplate(t);
                          setVariables(Object.fromEntries(varIndices.map((v) => [v, ''])));
                        }
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl border border-gray-100 hover:border-teal-300 hover:bg-teal-50 transition-all flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{t.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{t.language} · {t.category}</p>
                      </div>
                      {sending === t.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-600 flex-shrink-0" />
                      ) : (
                        <Send size={13} className="text-teal-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
