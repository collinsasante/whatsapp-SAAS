'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send, Paperclip, CheckCheck, Check, Clock, XCircle, Mic, Square,
  X, FileText, ImageIcon, MapPin, User, Smile,
} from 'lucide-react';
import { messagesApi, mediaApi, contactsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useInboxStore } from '@/store/inbox.store';
import { useAuthStore } from '@/store/auth.store';
import { getSocket, SocketEvent } from '@/lib/socket';
import { cn, getInitials, formatMessageTime } from '@/lib/utils';
import { MessageStatus, MessageDirection } from '@whatsapp-platform/shared-types';
import type { Message } from '@whatsapp-platform/shared-types';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
}

interface Props {
  conversation: Conversation;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  [MessageStatus.QUEUED]: <Clock size={12} className="text-gray-400" />,
  [MessageStatus.SENT]: <Check size={12} className="text-gray-400" />,
  [MessageStatus.DELIVERED]: <CheckCheck size={12} className="text-gray-400" />,
  [MessageStatus.READ]: <CheckCheck size={12} className="text-blue-500" />,
  [MessageStatus.FAILED]: <XCircle size={12} className="text-red-500" />,
};

const EMOJI_LIST = [
  '😀','😂','😍','😊','😎','🙏','👍','❤️','🔥','✅',
  '😭','😢','😅','🤣','🤔','😴','🥺','🤗','😤','😡',
  '🎉','🎊','💯','⭐','🙌','👏','💪','🤝','✌️','👌',
  '🍕','🎵','📱','💻','🚀','💡','🌟','💰','🏆','🎯',
];

export default function ChatWindow({ conversation }: Props) {
  const { messages, setMessages, typingUsers } = useInboxStore();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [popupPos, setPopupPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 80 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const convMessages = messages[conversation.id] ?? [];
  const typing = typingUsers[conversation.id] ?? [];
  const isResolved = conversation.status === 'RESOLVED';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.emit(SocketEvent.JOIN_CONVERSATION, conversation.id);
    return () => {
      socket.emit(SocketEvent.LEAVE_CONVERSATION, conversation.id);
    };
  }, [conversation.id]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await messagesApi.list(conversation.id, { limit: 100 });
        setMessages(conversation.id, (res.data as { data: Message[] }).data);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [conversation.id, setMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [convMessages.length, scrollToBottom]);

  const closeMenus = useCallback(() => {
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
  }, []);

  const handleTyping = useCallback(() => {
    const socket = getSocket();
    socket.emit(SocketEvent.TYPING_START, { conversationId: conversation.id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit(SocketEvent.TYPING_STOP, { conversationId: conversation.id });
    }, 2000);
  }, [conversation.id]);

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
        } catch {
          toast.error('Failed to send voice note');
        } finally {
          setSending(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
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
    setText('');
    setSending(true);
    try {
      await messagesApi.send(conversation.id, { content, type: 'TEXT' });
    } catch {
      setText(content);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const sendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      const uploadRes = await mediaApi.upload(file);
      const { fileUrl: url } = uploadRes.data as { fileUrl: string; id: string };
      const type = file.type.startsWith('image/') ? 'IMAGE'
        : file.type.startsWith('video/') ? 'VIDEO'
        : file.type.startsWith('audio/') ? 'AUDIO'
        : 'DOCUMENT';
      await messagesApi.send(conversation.id, { type, mediaUrl: url, mediaCaption: file.name });
    } catch {
      toast.error('Failed to send file');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const sendLocation = async () => {
    closeMenus();
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setSending(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await messagesApi.send(conversation.id, {
            type: 'LOCATION',
            locationLatitude: pos.coords.latitude,
            locationLongitude: pos.coords.longitude,
            locationName: 'My Location',
          });
        } catch {
          toast.error('Failed to send location');
        } finally {
          setSending(false);
        }
      },
      () => { toast.error('Location access denied'); setSending(false); },
    );
  };

  const openContactPicker = async () => {
    closeMenus();
    try {
      const res = await contactsApi.list({ limit: 100 });
      setContacts((res.data as { data: { id: string; name: string | null; phone: string }[] }).data);
      setShowContactPicker(true);
    } catch {
      toast.error('Failed to load contacts');
    }
  };

  const sendContact = async (c: { name: string | null; phone: string }) => {
    setShowContactPicker(false);
    setSending(true);
    try {
      await messagesApi.send(conversation.id, {
        type: 'CONTACTS',
        contactName: c.name ?? c.phone,
        contactPhone: c.phone,
      });
    } catch {
      toast.error('Failed to send contact');
    } finally {
      setSending(false);
    }
  };

  const name = conversation.contact.name ?? conversation.contact.phone;

  return (
    <div className="flex-1 flex flex-col bg-white min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold">
          {getInitials(name)}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{name}</h3>
          <p className="text-xs text-gray-500">{conversation.contact.phone}</p>
        </div>
        <div className="flex items-center gap-2">
          {conversation.assignedTo && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
              {conversation.assignedTo.name}
            </span>
          )}
          <span className={cn(
            'text-xs px-2 py-1 rounded-full font-medium',
            conversation.status === 'OPEN' ? 'bg-green-100 text-green-700' :
            conversation.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-600',
          )}>
            {conversation.status}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-gray-50 min-h-0">
        {loading ? (
          <div className="flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600" /></div>
        ) : convMessages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-8">No messages yet. Start the conversation!</div>
        ) : (
          convMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} currentUserId={user?.id} />
          ))
        )}
        {typing.filter((id) => id !== user?.id).length > 0 && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Contact picker modal - uses fixed so it's not clipped */}
      {showContactPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setShowContactPicker(false)}>
          <div className="bg-white w-full max-w-sm rounded-t-2xl p-4 max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-800">Send Contact</h4>
              <button onClick={() => setShowContactPicker(false)}><X size={18} /></button>
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No contacts found</p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { void sendContact(c); }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-semibold">
                    {getInitials(c.name ?? c.phone)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.name ?? c.phone}</p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-100 p-4 flex-shrink-0">
        {sending && (
          <div className="flex items-center gap-2 px-1 pb-2 text-xs text-gray-500">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-600 flex-shrink-0" />
            <span>Sending…</span>
          </div>
        )}

        {/* Backdrop — transparent full-screen layer that closes menus on outside click.
            Rendered via fixed so overflow:hidden on parents doesn't affect it.
            z-40 so it's below the popups (z-50) but above everything else. */}
        {(showAttachMenu || showEmojiPicker) && (
          <div className="fixed inset-0 z-40" onClick={closeMenus} />
        )}

        {/* Attachment popup — fixed so it's never clipped by overflow:hidden ancestors */}
        {showAttachMenu && (
          <div
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden w-52"
            style={{ bottom: popupPos.bottom, left: popupPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { closeMenus(); fileInputRef.current?.click(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700"
            >
              <FileText size={16} className="text-blue-500" /> Document / File
            </button>
            <button
              onClick={() => { closeMenus(); photoInputRef.current?.click(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700"
            >
              <ImageIcon size={16} className="text-green-500" /> Photos &amp; Videos
            </button>
            <button
              onClick={() => { void sendLocation(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700"
            >
              <MapPin size={16} className="text-red-500" /> Location
            </button>
            <button
              onClick={() => { void openContactPicker(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm text-gray-700"
            >
              <User size={16} className="text-purple-500" /> Contact
            </button>
          </div>
        )}

        {/* Emoji picker — fixed so it's never clipped */}
        {showEmojiPicker && (
          <div
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-3 w-64"
            style={{ bottom: popupPos.bottom, left: popupPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-10 gap-1">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { setText((t) => t + emoji); }}
                  className="text-lg hover:bg-gray-100 rounded p-0.5 transition-colors leading-none"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Hidden file inputs */}
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.csv" className="hidden" onChange={(e) => { void sendFile(e); }} />
          <input ref={photoInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { void sendFile(e); }} />

          {/* Attach button */}
          <button
            ref={attachBtnRef}
            onClick={() => {
              const rect = attachBtnRef.current?.getBoundingClientRect();
              if (rect) setPopupPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
              setShowEmojiPicker(false);
              setShowAttachMenu((v) => !v);
            }}
            disabled={sending || isResolved}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 disabled:opacity-40 flex-shrink-0"
          >
            <Paperclip size={18} />
          </button>

          {/* Emoji button */}
          <button
            ref={emojiBtnRef}
            onClick={() => {
              const rect = emojiBtnRef.current?.getBoundingClientRect();
              if (rect) setPopupPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
              setShowAttachMenu(false);
              setShowEmojiPicker((v) => !v);
            }}
            disabled={sending || isResolved}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 disabled:opacity-40 flex-shrink-0"
          >
            <Smile size={18} />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={text}
            onChange={(e) => { setText(e.target.value); handleTyping(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
            placeholder={sending ? 'Sending…' : isResolved ? 'Conversation is resolved' : 'Type a message…'}
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
            disabled={sending || isResolved}
          />

          {/* Send / Record buttons */}
          {text.trim() ? (
            <button
              onClick={() => { void sendMessage(); }}
              disabled={sending || isResolved}
              className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white disabled:opacity-50 hover:bg-green-700 transition-colors flex-shrink-0"
            >
              <Send size={16} />
            </button>
          ) : recording ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={cancelRecording}
                title="Cancel recording"
                className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-300 transition-colors"
              >
                <X size={14} />
              </button>
              <button
                onClick={stopRecording}
                title="Send voice note"
                className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors animate-pulse"
              >
                <Square size={14} fill="white" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { void startRecording(); }}
              disabled={sending || isResolved}
              className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white disabled:opacity-50 hover:bg-green-700 transition-colors flex-shrink-0"
            >
              <Mic size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, currentUserId }: { message: Message; currentUserId?: string }) {
  const isOutbound = message.direction === MessageDirection.OUTBOUND;

  return (
    <div className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-xs lg:max-w-md xl:max-w-lg rounded-2xl px-4 py-2.5',
        isOutbound ? 'bg-green-500 text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm shadow-sm',
      )}>
        {message.content && <p className="text-sm leading-relaxed">{message.content}</p>}

        {/* Location */}
        {message.type === 'LOCATION' && (
          <a
            href={`https://maps.google.com/?q=${message.metadata?.['latitude']},${message.metadata?.['longitude']}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium mt-1', isOutbound ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700')}
          >
            <MapPin size={14} /> {(message.metadata?.['name'] as string) || 'View location'}
          </a>
        )}

        {/* Contact card */}
        {message.type === 'CONTACTS' && (
          <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-xs mt-1', isOutbound ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700')}>
            <User size={14} />
            <div>
              <p className="font-semibold">{(message.metadata?.['contactName'] as string) || 'Contact'}</p>
              <p className="opacity-75">{message.metadata?.['contactPhone'] as string}</p>
            </div>
          </div>
        )}

        {/* Media */}
        {message.mediaUrl && (
          <div className="mt-1">
            {message.type === 'IMAGE' && (
              <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer">
                <img
                  src={message.mediaUrl}
                  alt={message.mediaCaption ?? 'Image'}
                  className="rounded-lg max-w-xs cursor-pointer hover:opacity-90 transition-opacity"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </a>
            )}
            {message.type === 'VIDEO' && (
              <video controls className="rounded-lg max-w-xs" preload="metadata">
                <source src={message.mediaUrl} />
              </video>
            )}
            {message.type === 'AUDIO' && (
              <audio controls className="w-48 mt-1">
                <source src={message.mediaUrl} />
              </audio>
            )}
            {message.type === 'DOCUMENT' && (
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium mt-1',
                  isOutbound ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                )}
              >
                <FileText size={14} />
                <span>{message.mediaCaption ?? 'Download document'}</span>
              </a>
            )}
          </div>
        )}

        <div className={cn('flex items-center gap-1 mt-1', isOutbound ? 'justify-end' : 'justify-start')}>
          <span className={cn('text-xs', isOutbound ? 'text-green-100' : 'text-gray-400')}>
            {formatMessageTime(message.createdAt)}
          </span>
          {isOutbound && (
            <span className="ml-1">{STATUS_ICONS[message.status] ?? null}</span>
          )}
        </div>
      </div>
    </div>
  );
}
