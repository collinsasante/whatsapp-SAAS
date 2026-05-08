'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Paperclip, CheckCheck, Check, Clock, XCircle, Mic, Square } from 'lucide-react';
import { messagesApi, mediaApi } from '@/lib/api';
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

export default function ChatWindow({ conversation }: Props) {
  const { messages, setMessages, typingUsers } = useInboxStore();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const convMessages = messages[conversation.id] ?? [];
  const typing = typingUsers[conversation.id] ?? [];

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
        const file = new File([blob], 'voice-note.webm', { type: mimeType });
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

  const sendMessage = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    try {
      await messagesApi.send(conversation.id, { content, type: 'TEXT' });
    } catch {
      setText(content);
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
    }
  };

  const name = conversation.contact.name ?? conversation.contact.phone;

  return (
    <div className="flex-1 flex flex-col bg-white">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
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

      <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-gray-50">
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

      <div className="border-t border-gray-100 p-4">
        {sending && (
          <div className="flex items-center gap-2 px-1 pb-2 text-xs text-gray-500">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-600 flex-shrink-0" />
            <span>Uploading…</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => { void sendFile(e); }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={sending || conversation.status === 'RESOLVED'} className="text-gray-400 hover:text-gray-600 transition-colors p-2 disabled:opacity-40">
            <Paperclip size={18} />
          </button>
          <input
            type="text"
            value={text}
            onChange={(e) => { setText(e.target.value); handleTyping(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
            placeholder={sending ? 'Uploading…' : 'Type a message…'}
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
            disabled={sending || conversation.status === 'RESOLVED'}
          />
          {text.trim() ? (
            <button
              onClick={() => { void sendMessage(); }}
              disabled={sending || conversation.status === 'RESOLVED'}
              className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white disabled:opacity-50 hover:bg-green-700 transition-colors"
            >
              <Send size={16} />
            </button>
          ) : recording ? (
            <button
              onClick={stopRecording}
              className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors animate-pulse"
            >
              <Square size={14} fill="white" />
            </button>
          ) : (
            <button
              onClick={() => { void startRecording(); }}
              disabled={sending || conversation.status === 'RESOLVED'}
              className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white disabled:opacity-50 hover:bg-green-700 transition-colors"
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
        {message.mediaUrl && (
          <div className="mt-1">
            {message.type === 'IMAGE' && (
              <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer">
                <img src={message.mediaUrl} alt={message.mediaCaption ?? 'Image'} className="rounded-lg max-w-xs cursor-pointer hover:opacity-90 transition-opacity" />
              </a>
            )}
            {message.type === 'VIDEO' && (
              <video controls className="rounded-lg max-w-xs" preload="metadata">
                <source src={message.mediaUrl} />
              </video>
            )}
            {message.type === 'AUDIO' && (
              <audio controls className="w-48">
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
                <span>📄</span>
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
