'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send, Paperclip, CheckCheck, Check, Clock, XCircle, Mic, Square,
  X, FileText, ImageIcon, MapPin, User, Smile, Phone, MoreVertical,
  CheckCircle, RefreshCw, Copy, StickyNote, Archive, Trash2,
  Reply, SmilePlus, Star, Search, UserPlus, Pin, Info, ArrowRightLeft, Forward,
  AlertCircle, MessageSquare, StickyNote as NoteIcon, Images, Tag, Pencil, Download,
} from 'lucide-react';
import { messagesApi, mediaApi, contactsApi, conversationsApi, usersApi, activityLogApi, cannedResponsesApi, tagsApi } from '@/lib/api';
import LibraryPickerModal from './LibraryPickerModal';
import toast from 'react-hot-toast';
import { useInboxStore } from '@/store/inbox.store';
import { useAuthStore } from '@/store/auth.store';
import { getSocket, SocketEvent } from '@/lib/socket';
import { cn, getInitials, formatMessageTime, getProxiedMediaUrl } from '@/lib/utils';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const META_VIDEO_LIMIT_MB = 16;
import { MessageStatus, MessageDirection } from '@whatsapp-platform/shared-types';
import type { Message } from '@whatsapp-platform/shared-types';
import type { ActivityEntry } from '@/store/inbox.store';

interface TeamMember { id: string; name: string; email: string; avatarUrl?: string | null; }

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
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
}

interface Props {
  conversation: Conversation;
  showDetails?: boolean;
  onToggleDetails?: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  [MessageStatus.QUEUED]: <Clock size={11} className="text-teal-200" />,
  [MessageStatus.SENT]: <Check size={11} className="text-teal-200" />,
  [MessageStatus.DELIVERED]: <CheckCheck size={11} className="text-teal-200" />,
  [MessageStatus.READ]: <CheckCheck size={11} className="text-teal-100" />,
  [MessageStatus.FAILED]: <XCircle size={11} className="text-red-300" />,
};

const EMOJI_CATEGORIES = [
  { label: '😊', name: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  { label: '👋', name: 'People', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','🥷','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','🧑‍🍼','🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚','🧌','👼','🎅','🤶'] },
  { label: '🐶', name: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'] },
  { label: '🍔', name: 'Food', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🥜','🍞','🥐','🥖','🫓','🥨','🥯','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🍛','🍜','🍝','🍢','🍣','🍤','🍙','🍱','🥟','🍱','🍘','🍥','🥮','🍡','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🫖','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'] },
  { label: '⚽', name: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🤿','🎽','🎿','🛷','🥌','🎯','🪀','🪆','🎮','🎲','♟️','🎭','🎨','🖼️','🎰','🏋️','🤼','🤺','🏇','⛷️','🏂','🤾','🏌️','🧗','🚵','🎠','🎡','🎢','🎪','🤹','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻'] },
  { label: '❤️', name: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','✡️','☯️','☦️','⚛️','🆔','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🔔','❓','❔','❕','❗','✅','❎','🌐','💠','➕','➖','➗','✖️','🟰','♾️','💱','™️','©️','®️','⚡','🌟','💫','✨','🎉','🎊','🎈','🎁','🎀'] },
];
const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

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
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', urgent ? 'bg-orange-100 text-orange-600' : 'bg-blue-50 text-blue-600')}>
      ⏱ {display}
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

export default function ChatWindow({ conversation, showDetails, onToggleDetails }: Props) {
  const { messages, setMessages, addMessage, typingUsers, removeMessage, removeConversation, updateConversation, activityLogs, setActivityLogs } = useInboxStore();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [popupPos, setPopupPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 80 });
  const [liveLocation, setLiveLocation] = useState<{ active: boolean; expiresAt: number; intervalId: ReturnType<typeof setInterval> | null }>({ active: false, expiresAt: 0, intervalId: null });

  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [localStatus, setLocalStatus] = useState(conversation.status);
  const [replyTo, setReplyTo] = useState<{ id: string; content?: string; type: string; direction: string; mediaCaption?: string } | null>(null);

  // Transfer
  const [showTransfer, setShowTransfer] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [transferring, setTransferring] = useState(false);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Input mode: 'message' | 'note'
  const [inputMode, setInputMode] = useState<'message' | 'note'>('message');
  const [savingNote, setSavingNote] = useState(false);

  // Add label
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [savedTags, setSavedTags] = useState<{ id: string; name: string; color?: string }[]>([]);

  // @mention
  const [mentionSearch, setMentionSearch] = useState('');
  const [showMentions, setShowMentions] = useState(false);

  // Canned responses
  const [cannedSuggestions, setCannedSuggestions] = useState<{ id: string; shortcut: string; content: string }[]>([]);
  const [showCanned, setShowCanned] = useState(false);

  const activityLog = activityLogs[conversation.id] ?? [];

  // Notes displayed inline in chat
  const [notes, setNotes] = useState<{ id: string; content: string; createdAt: string; author: { id: string; name: string } }[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const convMessages = messages[conversation.id] ?? [];
  const typing = typingUsers[conversation.id] ?? [];
  const isResolved = localStatus === 'RESOLVED';
  const isArchived = localStatus === 'ARCHIVED';
  const name = conversation.contact.name ?? conversation.contact.phone;
  const avatarColor = getAvatarColor(name);

  const lastInboundMsg = [...convMessages].reverse().find((m) => m.direction === MessageDirection.INBOUND);
  const sessionExpiredMs = 24 * 60 * 60 * 1000;
  const sessionExpired = !lastInboundMsg || (Date.now() - new Date(lastInboundMsg.createdAt).getTime()) > sessionExpiredMs;
  const isExpiredResolved = isResolved && sessionExpired;

  const filteredMessages = searchQuery
    ? convMessages.filter((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
    : convMessages;

  const ACTIVITY_NOISE = new Set(['MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_STARRED', 'MESSAGE_RECEIVED']);

  type TimelineItem =
    | { kind: 'message'; item: Message; sortKey: number }
    | { kind: 'note'; item: typeof notes[number]; sortKey: number }
    | { kind: 'activity'; item: ActivityEntry; sortKey: number };

  const timeline: TimelineItem[] = [
    ...filteredMessages.map((m) => ({ kind: 'message' as const, item: m, sortKey: new Date(m.createdAt).getTime() })),
    ...notes.map((n) => ({ kind: 'note' as const, item: n, sortKey: new Date(n.createdAt).getTime() })),
    ...activityLog
      .filter((a) => !ACTIVITY_NOISE.has(a.action))
      .map((a) => ({ kind: 'activity' as const, item: a, sortKey: new Date(a.createdAt).getTime() })),
  ].sort((a, b) => a.sortKey - b.sortKey);

  const timelineGroups = (() => {
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
  })();

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
    const load = async () => {
      setLoading(true);
      try {
        const [msgsRes, notesRes, activityRes] = await Promise.allSettled([
          messagesApi.list(conversation.id, { limit: 100 }),
          conversationsApi.getNotes(conversation.id),
          activityLogApi.forConversation(conversation.id),
        ]);
        if (msgsRes.status === 'fulfilled') { setMessages(conversation.id, (msgsRes.value.data as { data: Message[] }).data); scrollToBottom(true); }
        if (notesRes.status === 'fulfilled') setNotes(notesRes.value.data as typeof notes);
        if (activityRes.status === 'fulfilled') setActivityLogs(conversation.id, (activityRes.value.data as ActivityEntry[]) ?? []);
        void conversationsApi.markRead(conversation.id).catch(() => {});
        updateConversation(conversation.id, { unreadCount: 0 });
      } finally { setLoading(false); }
    };
    void load();
  }, [conversation.id, setMessages, updateConversation, setActivityLogs]);

  useEffect(() => { scrollToBottom(); }, [convMessages.length, scrollToBottom]);

  useEffect(() => {
    return () => {
      setLiveLocation((prev) => {
        if (prev.intervalId) clearInterval(prev.intervalId);
        return { active: false, expiresAt: 0, intervalId: null };
      });
    };
  }, [conversation.id]);

  useEffect(() => { setLocalStatus(conversation.status); }, [conversation.status]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) setShowHeaderMenu(false);
    };
    if (showHeaderMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHeaderMenu]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (labelMenuRef.current && !labelMenuRef.current.contains(e.target as Node)) setShowAddLabel(false);
    };
    if (showAddLabel) {
      document.addEventListener('mousedown', handler);
      if (savedTags.length === 0) {
        tagsApi.list().then(r => setSavedTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
      }
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddLabel, savedTags.length]);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  const loadTeamMembers = useCallback(async () => {
    if (teamMembers.length > 0) return;
    try {
      const res = await usersApi.list();
      setTeamMembers(res.data as TeamMember[]);
    } catch { toast.error('Failed to load team members'); }
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
      updateConversation(conversation.id, { assignedTo: { id: memberId, name: memberName } });
      toast.success(`Transferred to ${memberName}`);
      setShowTransfer(false);
    } catch { toast.error('Failed to transfer conversation'); }
    finally { setTransferring(false); }
  };

  const closeMenus = useCallback(() => {
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    setShowHeaderMenu(false);
    setEmojiSearch('');
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
      const q = val.slice(1);
      if (q.length === 0) {
        // show all on bare "/"
        try {
          const res = await cannedResponsesApi.search('');
          setCannedSuggestions(res.data as { id: string; shortcut: string; content: string }[]);
          setShowCanned(true);
        } catch { setShowCanned(false); }
      } else {
        try {
          const res = await cannedResponsesApi.search(q);
          const items = res.data as { id: string; shortcut: string; content: string }[];
          setCannedSuggestions(items);
          setShowCanned(items.length > 0);
        } catch { setShowCanned(false); }
      }
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
      contactId: conversation.contact.phone,
    } as unknown as Message);

    setSending(true);
    try {
      await messagesApi.send(conversation.id, { content, type: 'TEXT', ...(replyToId ? { replyToId } : {}) });
    } catch {
      removeMessage(conversation.id, tempId);
      setText(content);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const sendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = file.type.startsWith('video/') ? META_VIDEO_LIMIT_MB * 1024 * 1024 : 64 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(`File too large. Max: ${file.type.startsWith('video/') ? META_VIDEO_LIMIT_MB + 'MB' : '64MB'}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setSending(true);
    try {
      const uploadRes = await mediaApi.upload(file);
      const { fileUrl: url } = uploadRes.data as { fileUrl: string };
      const type = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
      await messagesApi.send(conversation.id, { type, mediaUrl: url, ...(type !== 'IMAGE' ? { mediaCaption: file.name } : {}) });
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      toast.error(typeof msg === 'string' ? msg : 'Failed to send file');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
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
    } catch { toast.error('Failed to resolve'); }
  };

  const handleReopen = async () => {
    setShowHeaderMenu(false);
    try {
      const res = await conversationsApi.reopen(conversation.id);
      const data = res.data as { status: string; slaDeadline?: string; requestedAt?: string };
      setLocalStatus('REQUESTED');
      updateConversation(conversation.id, { status: 'REQUESTED', slaDeadline: data.slaDeadline, requestedAt: data.requestedAt });
      toast.success('Conversation reopened');
    } catch { toast.error('Failed to reopen'); }
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
    } catch { toast.error('Failed to intervene'); }
  };

  const handleMarkPending = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.update(conversation.id, { status: 'PENDING' });
      setLocalStatus('PENDING');
      updateConversation(conversation.id, { status: 'PENDING' });
      toast.success('Marked as pending');
    } catch { toast.error('Failed to update'); }
  };

  const handleArchive = async () => {
    setShowHeaderMenu(false);
    try {
      await conversationsApi.archive(conversation.id);
      setLocalStatus('ARCHIVED');
      toast.success('Conversation archived');
    } catch { toast.error('Failed to archive'); }
  };

  const handleAddLabel = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const existing = conversation.labels ?? [];
    if (existing.includes(trimmed)) { toast.error('Label already added'); return; }
    try {
      const updated = [...existing, trimmed];
      await conversationsApi.update(conversation.id, { labels: updated });
      updateConversation(conversation.id, { labels: updated });
      setLabelInput('');
      toast.success(`Label "${trimmed}" added`);
    } catch { toast.error('Failed to add label'); }
  };

  const handleRemoveLabel = async (label: string) => {
    const updated = (conversation.labels ?? []).filter(l => l !== label);
    try {
      await conversationsApi.update(conversation.id, { labels: updated });
      updateConversation(conversation.id, { labels: updated });
    } catch { toast.error('Failed to remove label'); }
  };

  const selectMention = useCallback((member: TeamMember) => {
    const atIdx = text.lastIndexOf('@');
    if (atIdx !== -1) setText(text.slice(0, atIdx) + '@' + member.name + ' ');
    setShowMentions(false);
    setMentionSearch('');
  }, [text]);

  const handleDeleteConversation = async () => {
    setShowHeaderMenu(false);
    if (!window.confirm('Delete this conversation and all messages? This cannot be undone.')) return;
    try {
      await conversationsApi.delete(conversation.id);
      removeConversation(conversation.id);
      toast.success('Conversation deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const isRequested = localStatus === 'REQUESTED';
  const isIntervened = localStatus === 'INTERVENED';

  const handleDownloadChat = () => {
    const lines: string[] = [`Conversation with ${name}`, `Exported: ${new Date().toLocaleString()}`, '─'.repeat(50), ''];
    for (const entry of timeline) {
      if (entry.kind === 'message') {
        const m = entry.item;
        if (m.deletedForEveryone) continue;
        const ts = new Date(m.createdAt).toLocaleString();
        const sender = m.direction === 'OUTBOUND' ? 'Agent' : name;
        const body = m.content ?? (m.mediaUrl ? `[${m.type} media]` : `[${m.type}]`);
        lines.push(`[${ts}] ${sender}: ${body}${m.isEdited ? ' (edited)' : ''}`);
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
  const inputDisabled = inputMode === 'note' ? savingNote : (savingNote || isResolved || isRequested || sessionBlocked);
  const sendDisabled = sending || inputDisabled;
  const statusColor =
    localStatus === 'RESOLVED' ? 'text-gray-400' :
    localStatus === 'ARCHIVED' ? 'text-gray-400' :
    localStatus === 'REQUESTED' ? 'text-orange-600' :
    localStatus === 'INTERVENED' ? 'text-indigo-600' :
    'text-teal-600';

  return (
    <div className="flex-1 flex flex-col bg-white min-h-0 relative">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0 bg-white">
        {showSearch ? (
          <div className="flex-1 flex items-center gap-2">
            <Search size={15} className="text-gray-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="flex-1 text-sm focus:outline-none text-gray-700 placeholder-gray-400"
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="text-gray-400 hover:text-gray-600">
              <X size={15} />
            </button>
          </div>
        ) : (
          <>
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
                   localStatus === 'REQUESTED' ? 'Support requested' :
                   localStatus === 'INTERVENED' ? 'Agent intervened' :
                   localStatus}
                </p>
                {(isRequested || isIntervened) && (
                  <SessionCountdown lastInboundAt={conversation.lastInboundAt} />
                )}
                {(conversation.labels ?? []).slice(0, 3).map(l => (
                  <span key={l} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-full font-medium">{l}</span>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-0.5">
              {/* Intervene button — shown only for REQUESTING conversations */}
              {isRequested && (
                <button
                  onClick={() => { void handleIntervene(); }}
                  title="Take over this conversation"
                  className="h-8 px-2.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <UserPlus size={13} />
                  Intervene
                </button>
              )}

              {/* Resolve / Reopen quick button */}
              {localStatus !== 'RESOLVED' && localStatus !== 'ARCHIVED' ? (
                <button
                  onClick={() => { void handleResolve(); }}
                  title="Resolve"
                  className="h-8 px-3 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <CheckCircle size={13} />
                  Resolve
                </button>
              ) : isResolved ? (
                <button
                  onClick={() => { void handleReopen(); }}
                  title="Reopen"
                  className="h-8 px-3 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  Reopen
                </button>
              ) : null}

              {/* Transfer */}
              <button
                onClick={openTransfer}
                title="Transfer to team member"
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <ArrowRightLeft size={15} />
              </button>

              {/* Add Label */}
              <div className="relative" ref={labelMenuRef}>
                <button
                  onClick={() => setShowAddLabel((v) => !v)}
                  title="Add label"
                  className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showAddLabel ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50')}
                >
                  <Tag size={15} />
                </button>
                {showAddLabel && (
                  <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-64 p-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Labels</p>

                    {/* Current labels with remove */}
                    {(conversation.labels ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {(conversation.labels ?? []).map((l) => (
                          <span key={l} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full">
                            {l}
                            <button onClick={() => { void handleRemoveLabel(l); }} className="text-teal-400 hover:text-teal-600 ml-0.5">
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Saved tag suggestions */}
                    {savedTags.filter(t => !(conversation.labels ?? []).includes(t.name)).length > 0 && (
                      <div className="mb-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Saved Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {savedTags.filter(t => !(conversation.labels ?? []).includes(t.name)).map(tag => (
                            <button key={tag.id} onClick={() => { void handleAddLabel(tag.name); }}
                              className="text-xs px-2.5 py-1 rounded-full border transition-colors hover:opacity-80"
                              style={{ borderColor: tag.color ?? '#e5e7eb', color: tag.color ?? '#374151', backgroundColor: tag.color ? tag.color + '20' : '#f9fafb' }}>
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custom label input */}
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
                )}
              </div>

              {/* Customer Info toggle */}
              {onToggleDetails && (
                <button
                  onClick={onToggleDetails}
                  title={showDetails ? 'Hide customer info' : 'Show customer info'}
                  className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showDetails ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50')}
                >
                  <Info size={15} />
                </button>
              )}

              {/* Search */}
              <button
                onClick={() => setShowSearch(true)}
                title="Search messages"
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Search size={15} />
              </button>

              {/* Call */}
              <a
                href={`tel:${conversation.contact.phone.replace(/\D/g, '')}`}
                title="Call"
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Phone size={15} />
              </a>

              {/* More actions */}
              <div className="relative" ref={headerMenuRef}>
                <button
                  onClick={() => setShowHeaderMenu((v) => !v)}
                  className={cn('w-8 h-8 flex items-center justify-center rounded-lg transition-colors', showHeaderMenu ? 'bg-teal-50 text-teal-600' : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50')}
                >
                  <MoreVertical size={15} />
                </button>
                {showHeaderMenu && (
                  <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-[190px] py-1 overflow-hidden">
                    <button onClick={handleDownloadChat} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
                      <Download size={13} className="text-gray-400" /> Download chat
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Messages area */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 bg-[#f0f2f5] min-h-0 space-y-0.5">
            {loading ? (
              <div className="flex justify-center pt-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
            ) : timeline.length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-12">
                {searchQuery ? `No messages matching "${searchQuery}"` : 'No messages yet. Start the conversation!'}
              </div>
            ) : (
              timelineGroups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center justify-center my-3">
                    <span className="text-xs text-gray-500 bg-white/80 px-3 py-1 rounded-full shadow-sm">{group.label}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((entry) =>
                      entry.kind === 'note' ? (
                        <NoteBubble key={`note-${entry.item.id}`} note={entry.item} />
                      ) : entry.kind === 'activity' ? (
                        <ActivityBubble key={`act-${entry.item.id}`} entry={entry.item} />
                      ) : (
                        <MessageBubble
                          key={entry.item.id}
                          message={entry.item}
                          currentUserId={user?.id}
                          contactName={name}
                          conversationId={conversation.id}
                          onReply={(m) => setReplyTo({ id: m.id, content: m.content ?? undefined, type: m.type, direction: m.direction, mediaCaption: m.mediaCaption ?? undefined })}
                        />
                      )
                    )}
                  </div>
                </div>
              ))
            )}
            {typing.filter((id) => id !== user?.id).length > 0 && (
              <div className="flex items-end gap-2 pl-1">
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', avatarColor)}>{getInitials(name)}</div>
                <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-100 px-4 pt-2 pb-3 flex-shrink-0 bg-white">
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

            {/* Requesting banner — agent must intervene before typing */}
            {isRequested && inputMode === 'message' && (
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

            {/* Session expired banner */}
            {sessionBlocked && inputMode === 'message' && (
              <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-200">
                <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs text-amber-700 flex-1">
                  <span className="font-medium">WhatsApp session has expired.</span> Send a template message to re-engage.
                </span>
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

            {/* Canned response suggestions */}
            {showCanned && cannedSuggestions.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden max-h-52 overflow-y-auto">
                <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-500">Canned Responses</span>
                  <span className="text-xs text-gray-400">— press Tab or click to insert</span>
                </div>
                {cannedSuggestions.map((c) => (
                  <button key={c.id} onClick={() => { setText(c.content); setShowCanned(false); }}
                    className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-teal-50 transition-colors text-left border-b border-gray-50 last:border-0">
                    <code className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-mono flex-shrink-0 mt-0.5">/{c.shortcut}</code>
                    <span className="text-xs text-gray-700 line-clamp-2">{c.content}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Mode tabs */}
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

            {/* Emoji picker */}
            {showEmojiPicker && (
              <div className="fixed z-50 bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col" style={{ bottom: popupPos.bottom, left: popupPos.left, width: 320, maxHeight: 380 }} onClick={(e) => e.stopPropagation()}>
                <div className="p-2 border-b border-gray-100">
                  <input type="text" placeholder="Search emoji…" value={emojiSearch} onChange={(e) => setEmojiSearch(e.target.value)} className="w-full px-3 py-1.5 text-sm bg-gray-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" autoFocus />
                </div>
                {!emojiSearch && (
                  <div className="flex border-b border-gray-100 overflow-x-auto">
                    {EMOJI_CATEGORIES.map((cat, i) => (
                      <button key={cat.name} onClick={() => setEmojiCategory(i)} title={cat.name} className={cn('px-3 py-2 text-base flex-shrink-0 transition-colors', emojiCategory === i ? 'border-b-2 border-teal-600' : 'hover:bg-gray-50')}>{cat.label}</button>
                    ))}
                  </div>
                )}
                <div className="overflow-y-auto p-2 flex-1">
                  <div className="grid grid-cols-9 gap-0.5">
                    {(emojiSearch ? ALL_EMOJIS.filter((e) => e.includes(emojiSearch)) : EMOJI_CATEGORIES[emojiCategory].emojis).map((emoji, i) => (
                      <button key={`${emoji}-${i}`} onClick={() => { setText((t) => t + emoji); }} className="text-xl hover:bg-gray-100 rounded-lg p-1 transition-colors leading-none aspect-square flex items-center justify-center">{emoji}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* @mention dropdown */}
            {showMentions && inputMode === 'note' && (
              <div className="mb-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {teamMembers.filter((m) => m.name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5).length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No team members found</p>
                ) : (
                  teamMembers.filter((m) => m.name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5).map((m) => (
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

            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.csv" className="hidden" onChange={(e) => { void sendFile(e); }} />
              <input ref={photoInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { void sendFile(e); }} />

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

              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => { void handleTextChange(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowCanned(false); setShowMentions(false); }
                  if (e.key === 'Tab' && showCanned && cannedSuggestions.length > 0) {
                    e.preventDefault();
                    const first = cannedSuggestions[0];
                    if (first) { setText(first.content); setShowCanned(false); }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
                }}
                placeholder={
                  savingNote ? 'Saving note…' :
                  sending ? 'Sending…' :
                  inputMode === 'note' ? 'Use @ to mention a team member…' :
                  isResolved ? 'Reopen conversation to send messages' :
                  isRequested ? 'Intervene to start messaging…' :
                  sessionBlocked ? 'Session expired — send a template to re-engage' :
                  'Send your message...'
                }
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors border',
                  inputMode === 'note'
                    ? 'bg-yellow-50 border-yellow-200 focus:ring-yellow-400 focus:bg-yellow-50'
                    : 'bg-gray-50 border-gray-100 focus:ring-teal-500 focus:bg-white focus:border-teal-300',
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
                      if (rect) setPopupPos({ left: Math.max(0, rect.right - 320), bottom: window.innerHeight - rect.top + 8 });
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
                      if (rect) setPopupPos({ left: Math.max(0, rect.right - 320), bottom: window.innerHeight - rect.top + 8 });
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
                    if (rect) setPopupPos({ left: Math.max(0, rect.right - 320), bottom: window.innerHeight - rect.top + 8 });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowLocationPicker(false)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><MapPin size={18} className="text-red-500" /><h4 className="font-semibold text-gray-900">Share Location</h4></div>
              <button onClick={() => setShowLocationPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              {LOCATION_DURATIONS.map(({ label, minutes }) => (
                <button key={minutes} onClick={() => { setShowLocationPicker(false); void startLiveLocation(minutes); }} className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 hover:bg-teal-50 hover:text-teal-700 transition-colors text-sm font-medium text-gray-700">
                  <span>{label}</span><MapPin size={14} className="opacity-50" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* File Library picker */}
      {showLibraryPicker && (
        <LibraryPickerModal
          onClose={() => setShowLibraryPicker(false)}
          onSend={async (items) => {
            for (const item of items) {
              await messagesApi.send(conversation.id, {
                type: item.type,
                mediaUrl: item.mediaUrl,
                mediaCaption: item.mediaCaption ?? undefined,
                mediaType: item.mediaType ?? undefined,
              });
            }
          }}
        />
      )}

      {/* Transfer modal */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTransfer(false)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><UserPlus size={16} className="text-teal-600" /><h4 className="font-semibold text-gray-900">Transfer Conversation</h4></div>
              <button onClick={() => setShowTransfer(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto space-y-1">
              {teamMembers.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Loading team members...</p>
              ) : (
                teamMembers.map((m) => (
                  <button
                    key={m.id}
                    disabled={transferring}
                    onClick={() => { void handleTransfer(m.id, m.name); }}
                    className="w-full flex items-center gap-3 p-2.5 hover:bg-teal-50 rounded-xl text-left transition-colors"
                  >
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold', getAvatarColor(m.name))}>{getInitials(m.name)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{m.name}</p>
                      <p className="text-xs text-gray-400 truncate">{m.email}</p>
                    </div>
                    {conversation.assignedTo?.id === m.id && <span className="text-xs text-teal-600 font-medium">Assigned</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Note Bubble ──────────────────────────────────────────────────────────────

function NoteBubble({ note }: { note: { id: string; content: string; createdAt: string; author: { id: string; name: string } } }) {
  return (
    <div className="flex justify-center px-1 py-1">
      <div className="max-w-xs lg:max-w-md w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-1.5 mb-1">
          <StickyNote size={11} className="text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">Internal Note</span>
          <span className="text-xs text-amber-500 ml-1">· {note.author.name}</span>
        </div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{note.content}</p>
        <p className="text-xs text-amber-400 mt-1 text-right">
          {new Date(note.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ─── Activity Bubble ──────────────────────────────────────────────────────────

const ACTIVITY_LABELS: Record<string, (who: string, meta: Record<string, unknown>) => { text: string; color: string }> = {
  CONVERSATION_CREATED:      (who) => ({ text: `${who} started this conversation`, color: 'text-teal-600' }),
  CONVERSATION_RESOLVED:     (who) => ({ text: `${who} resolved this conversation`, color: 'text-green-600' }),
  CONVERSATION_REOPENED:     (who) => ({ text: `${who} reopened this conversation`, color: 'text-blue-600' }),
  CONVERSATION_ARCHIVED:     (who) => ({ text: `${who} archived this conversation`, color: 'text-gray-500' }),
  CONVERSATION_REQUESTED:    ()    => ({ text: 'Customer requested human support', color: 'text-orange-600' }),
  CONVERSATION_INTERVENED:   (who) => ({ text: `${who} intervened and took over`, color: 'text-indigo-600' }),
  CONVERSATION_TRANSFERRED:  (who, m) => ({
    text: m.toAgentName ? `${who} transferred to ${String(m.toAgentName)}` : `${who} transferred this conversation`,
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

function ActivityBubble({ entry }: { entry: ActivityEntry }) {
  const who = entry.user?.name ?? 'System';
  const labelFn = ACTIVITY_LABELS[entry.action];
  const { text, color } = labelFn
    ? labelFn(who, entry.metadata)
    : { text: `${who} ${entry.action.toLowerCase().replace(/_/g, ' ')}`, color: 'text-gray-500' };

  const time = new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex justify-center px-4 py-1.5">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3.5 py-1 shadow-sm max-w-lg">
        <span className={cn('text-xs font-medium', color)}>{text}</span>
        <span className="text-gray-200 text-xs">·</span>
        <span className="text-xs text-gray-400 flex-shrink-0">{time}</span>
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
    } catch { toast.error('Failed to forward message'); }
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
}

function MessageBubble({
  message,
  currentUserId,
  contactName,
  conversationId,
  onReply,
}: {
  message: Message;
  currentUserId?: string;
  contactName: string;
  conversationId: string;
  onReply?: (msg: Message) => void;
}) {
  const isOutbound = message.direction === MessageDirection.OUTBOUND;
  const avatarColor = getAvatarColor(contactName);
  const { removeMessage, updateMessage, conversations } = useInboxStore();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [starred, setStarred] = useState(message.isStarred ?? false);
  const [showReactions, setShowReactions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showForward, setShowForward] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    if (contextMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 320);
    setContextMenu({ x, y, messageId: message.id });
  };

  const handleCopy = () => {
    if (message.content) {
      void navigator.clipboard.writeText(message.content).then(() => toast.success('Copied'));
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
    } catch { toast.error('Failed to star message'); }
  };

  const handlePin = async () => {
    setContextMenu(null);
    try {
      await messagesApi.pin(conversationId, message.id);
      toast.success(message.isPinned ? 'Unpinned' : 'Pinned');
    } catch { toast.error('Failed to pin message'); }
  };

  const handleDeleteForMe = async () => {
    setContextMenu(null);
    if (!window.confirm('Delete this message for yourself?')) return;
    try {
      await messagesApi.deleteForMe(conversationId, message.id);
      removeMessage(conversationId, message.id);
    } catch { toast.error('Failed to delete message'); }
  };

  const handleDeleteForEveryone = async () => {
    setContextMenu(null);
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      await messagesApi.deleteForEveryone(conversationId, message.id);
      updateMessage(conversationId, message.id, { deletedForEveryone: true, content: null, mediaUrl: null, mediaCaption: null } as Partial<Message>);
    } catch { toast.error('Failed to delete message'); }
  };

  const handleEditStart = () => {
    setContextMenu(null);
    setEditText(message.content ?? '');
    setIsEditing(true);
  };

  const handleEditSubmit = async () => {
    const content = editText.trim();
    if (!content || content === message.content) { setIsEditing(false); return; }
    try {
      await messagesApi.edit(conversationId, message.id, content);
      updateMessage(conversationId, message.id, { content, isEdited: true, editedAt: new Date() } as Partial<Message>);
      setIsEditing(false);
    } catch { toast.error('Failed to edit message'); }
  };

  const handleReact = async (emoji: string) => {
    setShowReactions(false);
    setContextMenu(null);
    const typed = message as Message & { messageReactions?: Array<{ emoji: string; userId: string | null }> };
    const alreadyReacted = typed.messageReactions?.some(r => r.userId === currentUserId && r.emoji === emoji);
    try {
      if (alreadyReacted) {
        await messagesApi.removeReact(conversationId, message.id, emoji);
      } else {
        await messagesApi.react(conversationId, message.id, emoji);
      }
    } catch { toast.error('Failed to react'); }
  };

  return (
    <>
      <div
        id={`msg-${message.id}`}
        className={cn('flex items-end gap-2 group px-1 py-0.5', isOutbound ? 'justify-end' : 'justify-start')}
      >
        {!isOutbound && (
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 mb-5', avatarColor)}>
            {getInitials(contactName)}
          </div>
        )}

        <div className={cn('flex items-end gap-1 max-w-xs lg:max-w-md', isOutbound ? 'flex-row-reverse' : 'flex-row')}>
          <div className="flex flex-col gap-0.5">
            {/* Reply-to quote */}
            {message.replyTo && (
              <div
                className={cn(
                  'rounded-xl px-3 py-1.5 mb-0.5 border-l-3 cursor-pointer hover:opacity-80 transition-opacity',
                  isOutbound ? 'bg-teal-600/80 border-teal-300' : 'bg-gray-200 border-teal-500',
                )}
                onClick={() => {
                  const el = document.getElementById(`msg-${message.replyTo!.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.transition = 'background-color 0.3s ease';
                    el.style.backgroundColor = '#ccfbf1';
                    setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
                  }
                }}
              >
                <p className={cn('text-xs font-semibold', isOutbound ? 'text-teal-200' : 'text-teal-600')}>
                  {message.replyTo.direction === 'INBOUND' ? contactName : 'You'}
                </p>
                <p className={cn('text-xs truncate', isOutbound ? 'text-teal-100' : 'text-gray-600')}>
                  {message.replyTo.content ?? message.replyTo.mediaCaption ?? '📎 Media'}
                </p>
              </div>
            )}

            {/* Main bubble */}
            <div
              className={cn(
                'rounded-2xl px-3 py-2',
                isOutbound ? 'bg-teal-700 text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm shadow-sm',
              )}
              onContextMenu={openMenu}
            >
              {/* Forwarded indicator */}
              {(message as Message & { isForwarded?: boolean }).isForwarded && (
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

              {message.deletedForEveryone ? (
                <p className={cn('text-sm italic', isOutbound ? 'text-teal-200 opacity-70' : 'text-gray-400')}>
                  <span className="mr-1">🚫</span>This message was deleted
                </p>
              ) : isEditing ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleEditSubmit(); }
                      if (e.key === 'Escape') setIsEditing(false);
                    }}
                    className="text-sm bg-teal-600 text-white placeholder-teal-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300 min-w-[180px]"
                  />
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => setIsEditing(false)} className="text-xs text-teal-200 hover:text-white px-2 py-0.5 rounded">Cancel</button>
                    <button onClick={() => { void handleEditSubmit(); }} className="text-xs bg-white text-teal-700 font-semibold px-2 py-0.5 rounded hover:bg-teal-50">Save</button>
                  </div>
                </div>
              ) : (
                message.content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              )}
              {message.isEdited && !message.deletedForEveryone && !isEditing && (
                <span className={cn('text-xs', isOutbound ? 'text-teal-300' : 'text-gray-400')}>Edited</span>
              )}

              {!message.deletedForEveryone && message.type === 'LOCATION' && (
                <a href={`https://maps.google.com/?q=${message.metadata?.['latitude']},${message.metadata?.['longitude']}`} target="_blank" rel="noopener noreferrer"
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium mt-1', isOutbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700')}>
                  <MapPin size={14} /> {(message.metadata?.['name'] as string) || 'View location'}
                </a>
              )}

              {!message.deletedForEveryone && message.type === 'CONTACTS' && (
                <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs mt-1', isOutbound ? 'bg-teal-800 text-white' : 'bg-gray-100 text-gray-700')}>
                  <div className={cn('w-7 h-7 rounded-full flex items-center justify-center', isOutbound ? 'bg-teal-600' : 'bg-teal-100 text-teal-700')}><User size={14} /></div>
                  <div><p className="font-semibold">{(message.metadata?.['contactName'] as string) || 'Contact'}</p><p className="opacity-75">{message.metadata?.['contactPhone'] as string}</p></div>
                </div>
              )}

              {!message.deletedForEveryone && message.mediaUrl && (() => {
                const proxied = getProxiedMediaUrl(message.mediaUrl);
                return (
                  <div className="mt-1">
                    {message.type === 'IMAGE' && (
                      <button onClick={() => setLightboxSrc(proxied)} className="block group relative">
                        <img
                          src={proxied}
                          alt={message.mediaCaption ?? 'Image'}
                          className="rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity"
                          style={{ maxWidth: '320px', maxHeight: '400px', width: 'auto', height: 'auto', display: 'block', objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </button>
                    )}
                    {message.type === 'VIDEO' && (
                      <video controls className="rounded-xl" preload="metadata" style={{ maxWidth: '320px', maxHeight: '260px' }}>
                        <source src={proxied} />
                      </video>
                    )}
                    {message.type === 'AUDIO' && <audio controls className="w-56 mt-1"><source src={proxied} /></audio>}
                    {message.type === 'DOCUMENT' && (
                      <a href={proxied} target="_blank" rel="noopener noreferrer" className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium mt-1', isOutbound ? 'bg-teal-800 text-white hover:bg-teal-900' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                        <FileText size={14} /><span>{message.mediaCaption ?? 'Download document'}</span>
                      </a>
                    )}
                    {message.mediaCaption && message.type !== 'DOCUMENT' && (
                      <p className={cn('text-xs mt-1', isOutbound ? 'text-teal-200' : 'text-gray-500')}>{message.mediaCaption}</p>
                    )}
                  </div>
                );
              })()}
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

            {/* Timestamp + status */}
            <div className={cn('flex items-center gap-1.5 px-1', isOutbound ? 'justify-end' : 'justify-start')}>
              {starred && <Star size={10} className="text-yellow-500 fill-yellow-500" />}
              <span className="text-xs text-gray-400">{formatMessageTime(message.createdAt)}</span>
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
                <span className="text-xs text-red-400">Failed</span>
              )}
              <button onClick={() => setShowInfo((v) => !v)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity">
                <Info size={10} className="text-gray-400" />
              </button>
            </div>

            {/* Info expanded */}
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

      {/* Image lightbox */}
      {lightboxSrc && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center" onClick={() => setLightboxSrc(null)}>
          <button className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors" onClick={() => setLightboxSrc(null)}>
            <X size={20} />
          </button>
          <img src={lightboxSrc} alt="Full size" className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain" onClick={(e) => e.stopPropagation()} />
          <a href={lightboxSrc} download target="_blank" rel="noopener noreferrer" className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl transition-colors" onClick={(e) => e.stopPropagation()}>
            <Download size={13} /> Download
          </a>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden py-1.5 w-52"
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
          {isOutbound && message.type === 'TEXT' && !message.deletedForEveryone && (
            <button onClick={handleEditStart} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 text-gray-700">
              <Pencil size={14} className="text-gray-400" /> Edit
            </button>
          )}
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => { void handleDeleteForMe(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-red-50 text-red-600">
            <Trash2 size={14} className="text-red-500" /> Delete for me
          </button>
          {isOutbound && !message.deletedForEveryone && (
            <button onClick={() => { void handleDeleteForEveryone(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-red-50 text-red-600">
              <Trash2 size={14} className="text-red-500" /> Delete for everyone
            </button>
          )}
        </div>
      )}
    </>
  );
}
