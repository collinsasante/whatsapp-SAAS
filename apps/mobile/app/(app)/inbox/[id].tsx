import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useInboxStore } from '../../../src/store/inbox.store';
import { useAuthStore } from '../../../src/store/auth.store';
import type { Message } from '@whatsapp-platform/shared-types';
import { MessageDirection, MessageType, MessageStatus } from '@whatsapp-platform/shared-types';

const EMPTY_MESSAGES: Message[] = [];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Note {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string };
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
}

type InputMode = 'message' | 'note';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMessageTime(createdAt: Date | string): string {
  try {
    return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Session countdown ────────────────────────────────────────────────────────

function SessionBadge({ messages }: { messages: Message[] }) {
  const lastInbound = [...messages].reverse().find((m) => m.direction === MessageDirection.INBOUND);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!lastInbound) { setRemaining(null); return; }
    const update = () => {
      const diff = 24 * 3600 * 1000 - (Date.now() - new Date(lastInbound.createdAt).getTime());
      setRemaining(diff);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [lastInbound?.id]);

  if (remaining === null) return null;
  if (remaining <= 0) {
    return (
      <View className="self-center my-2 px-3 py-1 rounded-full bg-red-900/40 border border-red-500/30">
        <Text className="text-red-400 text-[10px] font-semibold">⏱ Session Expired — customer must message first</Text>
      </View>
    );
  }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const isUrgent = remaining < 3600000;
  return (
    <View className={`self-center my-2 px-3 py-1 rounded-full border ${isUrgent ? 'bg-red-900/30 border-red-500/30' : 'bg-white/5 border-white/10'}`}>
      <Text className={`text-[10px] font-semibold ${isUrgent ? 'text-red-400' : 'text-white/40'}`}>
        ⏱ Session: {h}h {String(m).padStart(2, '0')}m remaining
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [text, setText] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('message');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Zustand selectors — each subscribes to only its slice
  const rawChatMessages = useInboxStore((s) => id ? s.messages[id] : undefined);
  const chatMessages = rawChatMessages ?? EMPTY_MESSAGES;
  const hasMore = useInboxStore((s) => (id ? s.hasMoreMessages[id] : undefined) ?? false);
  const cursor = useInboxStore((s) => (id ? s.messageCursors[id] : undefined) ?? null);
  const conversation = useInboxStore((s) => s.conversations.find((c) => c.id === id));

  const setMessages = useInboxStore((s) => s.setMessages);
  const addMessage = useInboxStore((s) => s.addMessage);
  const prependMessages = useInboxStore((s) => s.prependMessages);
  const setMessageCursor = useInboxStore((s) => s.setMessageCursor);
  const updateConversation = useInboxStore((s) => s.updateConversation);

  const rawTypingUsers = useInboxStore((s) => (id ? s.typingUsers[id] : undefined));
  const typingUsers = rawTypingUsers ?? [];

  const userId = useAuthStore((s) => s.user?.id);
  const contactName = conversation?.contact?.name ?? conversation?.contact?.phone ?? 'Chat';
  const assignedName = conversation?.assignedTo?.name;

  // ── Fetch messages ────────────────────────────────────────────────────────

  const { data: _fetchedData, isLoading, isError, refetch } = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await apiClient.messages.list(id, { limit: 50 });
      const raw = res.data as { data?: Message[]; hasMore?: boolean } | Message[];
      const msgs: Message[] = Array.isArray(raw) ? raw : (raw.data ?? []);
      const more = Array.isArray(raw) ? false : (raw.hasMore ?? false);
      return { msgs, more };
    },
    enabled: !!id,
    throwOnError: false,
    retry: 1,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (_fetchedData && id) {
      setMessages(id, _fetchedData.msgs, _fetchedData.more);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_fetchedData]);

  // ── Fetch notes ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    apiClient.conversations.getNotes(id)
      .then((r) => setNotes((r.data as Note[]) ?? []))
      .catch(() => {});
  }, [id]);

  // ── Mark as read ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (id) {
      apiClient.conversations.markRead(id).catch(() => null);
      updateConversation(id, { unreadCount: 0 });
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom when new messages arrive ─────────────────────────────

  useEffect(() => {
    if (chatMessages.length > 0 && !isLoadingMore) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [chatMessages.length, isLoadingMore]);

  // ── Load older messages ───────────────────────────────────────────────────

  const loadOlderMessages = useCallback(async () => {
    if (!hasMore || !cursor || isLoadingMore || !id) return;
    setIsLoadingMore(true);
    try {
      const res = await apiClient.messages.list(id, { limit: 50, before: cursor });
      const raw = res.data as { data?: Message[]; hasMore?: boolean } | Message[];
      const older: Message[] = Array.isArray(raw) ? raw : (raw.data ?? []);
      const more = Array.isArray(raw) ? false : (raw.hasMore ?? false);
      if (older.length > 0) {
        prependMessages(id, older);
        const ts = older[0]?.createdAt;
        const newCursor = ts ? (() => { try { const d = new Date(ts); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; } })() : null;
        setMessageCursor(id, newCursor, more);
      } else {
        setMessageCursor(id, null, false);
      }
    } catch { /* silently fail */ } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, cursor, id, isLoadingMore, prependMessages, setMessageCursor]);

  // ── Send text / note ──────────────────────────────────────────────────────

  const sendMessage = async () => {
    const content = text.trim();
    if (!content || isSending || !id) return;
    setText('');
    setIsSending(true);

    if (inputMode === 'note') {
      try {
        const res = await apiClient.conversations.addNote(id, content);
        const note = res.data as Note;
        setNotes((prev) => [...prev, note]);
      } catch {
        Alert.alert('Error', 'Could not save note');
        setText(content);
      } finally {
        setIsSending(false);
      }
      return;
    }

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      tenantId: '',
      conversationId: id,
      contactId: '',
      senderId: userId ?? null,
      sender: null,
      content,
      type: MessageType.TEXT,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.QUEUED,
      createdAt: new Date(),
      mediaUrl: null, mediaType: null, mediaSize: null, mediaCaption: null,
      templateId: null, templateVariables: null, metadata: null,
      sentAt: null, deliveredAt: null, readAt: null, failedAt: null, failureReason: null,
      replyToId: null, replyTo: null,
      isStarred: false, isPinned: false, isEdited: false, editedAt: null,
      deletedForEveryone: false, deletedAt: null, whatsappMessageId: null,
    };
    addMessage(id, optimistic);
    try {
      await apiClient.messages.send(id, { type: 'TEXT', content });
    } catch { /* offline queue could handle this */ } finally {
      setIsSending(false);
    }
  };

  // ── Send image ────────────────────────────────────────────────────────────

  const sendImage = async () => {
    if (!id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to send images.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setIsSending(true);
    try {
      const formData = new FormData();
      const filename = asset.uri.split('/').pop() ?? 'upload';
      const type = asset.mimeType ?? (asset.uri.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
      formData.append('file', { uri: asset.uri, name: filename, type } as unknown as Blob);
      const uploadRes = await apiClient.http.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { fileUrl: url } = uploadRes.data as { fileUrl: string };
      const msgType = type.startsWith('video') ? 'VIDEO' : 'IMAGE';
      await apiClient.messages.send(id, { type: msgType, mediaUrl: url });
    } catch {
      Alert.alert('Error', 'Failed to send image');
    } finally {
      setIsSending(false);
    }
  };

  // ── Assign agent ──────────────────────────────────────────────────────────

  const openAssign = async () => {
    if (teamMembers.length === 0) {
      try {
        const res = await apiClient.workspace.listMembers();
        setTeamMembers((res.data as { data?: TeamMember[] }).data ?? (res.data as TeamMember[]) ?? []);
      } catch { Alert.alert('Error', 'Could not load team members'); return; }
    }
    setShowAssignModal(true);
  };

  const assignTo = async (memberId: string | null) => {
    if (!id) return;
    setShowAssignModal(false);
    try {
      await apiClient.conversations.update(id, { assignedToId: memberId });
      const member = teamMembers.find((m) => m.id === memberId);
      updateConversation(id, {
        assignedTo: member ? { id: member.id, name: member.name } : null,
      });
    } catch {
      Alert.alert('Error', 'Could not assign conversation');
    }
  };

  // ── Conversation actions ───────────────────────────────────────────────────

  const showActions = () => {
    const status = conversation?.status ?? 'OPEN';
    type ActionItem = { label: string; destructive?: boolean; action: () => void };
    const options: ActionItem[] = [];

    if (status === 'OPEN' || status === 'PENDING' || status === 'REQUESTED') {
      options.push({
        label: 'Resolve conversation',
        action: async () => {
          if (!id) return;
          try {
            await apiClient.conversations.resolve(id);
            updateConversation(id, { status: 'RESOLVED' });
            router.back();
          } catch { Alert.alert('Error', 'Could not resolve conversation'); }
        },
      });
    }
    if (status === 'RESOLVED') {
      options.push({
        label: 'Reopen conversation',
        action: async () => {
          if (!id) return;
          try {
            await apiClient.conversations.reopen(id);
            updateConversation(id, { status: 'OPEN' });
          } catch { Alert.alert('Error', 'Could not reopen conversation'); }
        },
      });
    }
    options.push({ label: 'Assign agent', action: openAssign });
    options.push({
      label: 'Archive',
      destructive: true,
      action: async () => {
        if (!id) return;
        try {
          await apiClient.conversations.archive(id);
          updateConversation(id, { status: 'ARCHIVED' as never });
          router.back();
        } catch { Alert.alert('Error', 'Could not archive conversation'); }
      },
    });

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), 'Cancel'],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: options.findIndex((o) => o.destructive),
        },
        (index) => { if (index < options.length) options[index]?.action(); },
      );
    } else {
      Alert.alert('Conversation', undefined, [
        ...options.map((o) => ({ text: o.label, style: (o.destructive ? 'destructive' : 'default') as 'destructive' | 'default', onPress: o.action })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // ── Timeline: merge messages + notes by date ──────────────────────────────

  type TimelineItem =
    | { kind: 'date'; label: string; key: string }
    | { kind: 'message'; item: Message; key: string }
    | { kind: 'note'; item: Note; key: string };

  const timeline = useMemo<TimelineItem[]>(() => {
    const all: Array<{ ts: number; item: TimelineItem }> = [
      ...chatMessages.map((m) => ({ ts: new Date(m.createdAt).getTime(), item: { kind: 'message' as const, item: m, key: m.id ?? `m-${Math.random()}` } })),
      ...notes.map((n) => ({ ts: new Date(n.createdAt).getTime(), item: { kind: 'note' as const, item: n, key: `note-${n.id}` } })),
    ];
    all.sort((a, b) => a.ts - b.ts);

    const result: TimelineItem[] = [];
    let lastLabel = '';
    for (const { ts, item } of all) {
      const label = getDateLabel(new Date(ts));
      if (label !== lastLabel) {
        result.push({ kind: 'date', label, key: `hdr-${label}` });
        lastLabel = label;
      }
      result.push(item);
    }
    return result;
  }, [chatMessages, notes]);

  // ── No ID guard ───────────────────────────────────────────────────────────

  if (!id) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center" edges={['top', 'bottom']}>
        <Text className="text-white/50">Conversation not found</Text>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>

      {/* Header */}
      <View className="flex-row items-center px-4 py-2.5 border-b border-white/5 gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>

        <View className="w-9 h-9 rounded-full bg-green/15 items-center justify-center border border-green/20 flex-shrink-0">
          <Text className="text-green font-bold text-sm">
            {contactName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View className="flex-1 min-w-0">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>{contactName}</Text>
          {typingUsers.length > 0 ? (
            <Text className="text-green text-xs">typing...</Text>
          ) : assignedName ? (
            <Text className="text-white/40 text-xs" numberOfLines={1}>Assigned to {assignedName}</Text>
          ) : (
            <Text className="text-white/30 text-xs">Unassigned</Text>
          )}
        </View>

        {/* Status badge */}
        {conversation?.status && (
          <View className={`px-2 py-0.5 rounded-full ${
            conversation.status === 'RESOLVED' ? 'bg-green/20' :
            conversation.status === 'PENDING' ? 'bg-orange-500/20' :
            conversation.status === 'REQUESTED' ? 'bg-blue-500/20' : 'bg-white/10'
          }`}>
            <Text className={`text-[10px] font-semibold uppercase ${
              conversation.status === 'RESOLVED' ? 'text-green' :
              conversation.status === 'PENDING' ? 'text-orange-400' :
              conversation.status === 'REQUESTED' ? 'text-blue-400' : 'text-white/40'
            }`}>{conversation.status}</Text>
          </View>
        )}

        <TouchableOpacity onPress={showActions} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={48} color="rgba(255,255,255,0.2)" />
          <Text className="text-white/50 text-base text-center">Failed to load messages</Text>
          <TouchableOpacity onPress={() => refetch()} className="bg-green rounded-xl px-6 py-3">
            <Text className="text-white font-semibold text-sm">Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={timeline}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === 'date') {
              return (
                <View className="items-center my-3">
                  <View className="bg-white/10 px-3 py-1 rounded-full">
                    <Text className="text-white/50 text-[11px] font-medium">{item.label}</Text>
                  </View>
                </View>
              );
            }
            if (item.kind === 'note') {
              return <NoteBubble note={item.item} />;
            }
            return <MessageBubble message={item.item} />;
          }}
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
          onContentSizeChange={() => {
            if (!isLoadingMore) listRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center">
              <Ionicons name="chatbubble-outline" size={40} color="rgba(255,255,255,0.15)" style={{ marginBottom: 10 }} />
              <Text className="text-white/30 text-sm">No messages yet</Text>
            </View>
          }
          ListHeaderComponent={
            hasMore ? (
              <TouchableOpacity className="items-center py-3" onPress={loadOlderMessages} disabled={isLoadingMore}>
                {isLoadingMore ? <ActivityIndicator color="#25D366" size="small" /> : <Text className="text-green text-xs font-medium">Load older messages</Text>}
              </TouchableOpacity>
            ) : null
          }
          ListFooterComponent={<SessionBadge messages={chatMessages} />}
        />
      )}

      {/* Input area */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Mode toggle */}
        <View className="flex-row px-4 pt-2 gap-2">
          <TouchableOpacity
            onPress={() => setInputMode('message')}
            className={`px-3 py-1 rounded-full ${inputMode === 'message' ? 'bg-green' : 'bg-white/10'}`}
          >
            <Text className={`text-xs font-semibold ${inputMode === 'message' ? 'text-white' : 'text-white/50'}`}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setInputMode('note')}
            className={`px-3 py-1 rounded-full ${inputMode === 'note' ? 'bg-yellow-600' : 'bg-white/10'}`}
          >
            <Text className={`text-xs font-semibold ${inputMode === 'note' ? 'text-white' : 'text-white/50'}`}>📝 Note</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row items-end px-4 py-3 border-t border-white/5 gap-2 mt-1">
          {/* Attach image */}
          <TouchableOpacity
            onPress={sendImage}
            disabled={isSending || inputMode === 'note'}
            className="w-9 h-9 items-center justify-center rounded-full bg-white/5"
            style={{ opacity: inputMode === 'note' ? 0.3 : 1 }}
          >
            <Ionicons name="image-outline" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          <TextInput
            className={`flex-1 rounded-2xl px-4 py-3 text-white text-base max-h-32 ${
              inputMode === 'note' ? 'bg-yellow-900/30 border border-yellow-600/30' : 'bg-surface-card'
            }`}
            placeholder={inputMode === 'note' ? 'Write a note (only visible to team)...' : 'Type a message...'}
            placeholderTextColor={inputMode === 'note' ? 'rgba(253,224,71,0.4)' : 'rgba(255,255,255,0.3)'}
            value={text}
            onChangeText={setText}
            multiline
            returnKeyType="default"
          />

          <TouchableOpacity
            className={`w-11 h-11 rounded-full items-center justify-center ${inputMode === 'note' ? 'bg-yellow-600' : 'bg-green'}`}
            onPress={sendMessage}
            disabled={!text.trim() || isSending}
            activeOpacity={0.8}
            style={{ opacity: !text.trim() || isSending ? 0.5 : 1 }}
          >
            {isSending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Assign Agent Modal */}
      <Modal visible={showAssignModal} transparent animationType="slide" onRequestClose={() => setShowAssignModal(false)}>
        <Pressable className="flex-1 bg-black/50" onPress={() => setShowAssignModal(false)} />
        <View className="bg-surface rounded-t-3xl pt-4 pb-8 max-h-[60%]">
          <View className="flex-row items-center justify-between px-5 mb-4">
            <Text className="text-white font-bold text-lg">Assign to</Text>
            <TouchableOpacity onPress={() => setShowAssignModal(false)}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              className="flex-row items-center px-5 py-3.5 border-b border-white/5"
              onPress={() => assignTo(null)}
            >
              <View className="w-9 h-9 rounded-full bg-white/10 items-center justify-center mr-3">
                <Ionicons name="person-remove-outline" size={16} color="rgba(255,255,255,0.5)" />
              </View>
              <Text className="text-white/60 text-sm">Unassign</Text>
            </TouchableOpacity>
            {teamMembers.map((m) => (
              <TouchableOpacity
                key={m.id}
                className="flex-row items-center px-5 py-3.5 border-b border-white/5"
                onPress={() => assignTo(m.id)}
              >
                <View className="w-9 h-9 rounded-full bg-green/15 items-center justify-center mr-3 border border-green/20">
                  <Text className="text-green font-bold text-sm">{m.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-white text-sm font-medium" numberOfLines={1}>{m.name}</Text>
                  <Text className="text-white/40 text-xs" numberOfLines={1}>{m.role?.toLowerCase()}</Text>
                </View>
                {conversation?.assignedTo?.id === m.id && (
                  <Ionicons name="checkmark-circle" size={18} color="#25D366" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Note bubble ──────────────────────────────────────────────────────────────

function NoteBubble({ note }: { note: Note }) {
  return (
    <View className="mb-2 max-w-[85%] self-center w-full">
      <View className="bg-yellow-900/40 border border-yellow-600/30 rounded-2xl px-3.5 py-2.5">
        <View className="flex-row items-center gap-1.5 mb-1">
          <Text className="text-yellow-400 text-xs">📝</Text>
          <Text className="text-yellow-400/80 text-xs font-semibold">{note.author?.name ?? 'Agent'}</Text>
        </View>
        <Text className="text-yellow-100 text-sm leading-5 italic">{note.content}</Text>
      </View>
      <Text className="text-white/25 text-[10px] mt-0.5 text-center">{formatMessageTime(note.createdAt)}</Text>
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === MessageDirection.OUTBOUND;
  return (
    <View className={`mb-2 max-w-[80%] ${isOutbound ? 'self-end' : 'self-start'}`}>
      <View className={`rounded-2xl px-3.5 py-2.5 ${
        isOutbound ? 'bg-green rounded-br-sm' : 'bg-surface-card rounded-bl-sm'
      }`}>
        <MessageContent message={message} />
      </View>
      <View className={`flex-row items-center mt-1 gap-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
        <Text className="text-white/30 text-[10px]">{formatMessageTime(message.createdAt)}</Text>
        {isOutbound && <StatusTick status={message.status} />}
      </View>
    </View>
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.type) {
    case MessageType.TEXT:
      return <Text className="text-white text-sm leading-5">{message.content ?? ''}</Text>;

    case MessageType.NOTE:
      return (
        <View className="flex-row items-start gap-1.5">
          <Text className="text-yellow-400 text-sm">📝</Text>
          <Text className="text-yellow-100 text-sm leading-5 italic flex-1">{message.content ?? ''}</Text>
        </View>
      );

    case MessageType.IMAGE:
      return message.mediaUrl ? (
        <View>
          <Image source={{ uri: message.mediaUrl }} style={{ width: 200, height: 150, borderRadius: 8 }} contentFit="cover" />
          {message.mediaCaption ? <Text className="text-white text-xs mt-1.5">{message.mediaCaption}</Text> : null}
        </View>
      ) : <MediaPlaceholder icon="📷" label="Photo" />;

    case MessageType.VIDEO:
      return (
        <View>
          <View className="w-[200px] h-[150px] rounded-lg bg-black/40 items-center justify-center">
            <Text className="text-4xl">▶️</Text>
          </View>
          {message.mediaCaption ? <Text className="text-white text-xs mt-1.5">{message.mediaCaption}</Text> : null}
        </View>
      );

    case MessageType.AUDIO:
      return (
        <View className="flex-row items-center gap-2 min-w-[140px]">
          <Text className="text-2xl">🎵</Text>
          <View className="flex-1">
            <Text className="text-white text-xs font-medium">Voice message</Text>
            {message.mediaSize != null && <Text className="text-white/40 text-[10px]">{formatBytes(message.mediaSize)}</Text>}
          </View>
        </View>
      );

    case MessageType.DOCUMENT:
      return (
        <View className="flex-row items-center gap-2 min-w-[160px]">
          <Text className="text-2xl">📄</Text>
          <View className="flex-1 min-w-0">
            <Text className="text-white text-xs font-medium" numberOfLines={2}>{message.content ?? 'Document'}</Text>
            {message.mediaSize != null && <Text className="text-white/40 text-[10px]">{formatBytes(message.mediaSize)}</Text>}
          </View>
        </View>
      );

    case MessageType.TEMPLATE:
      return (
        <View>
          <Text className="text-white/50 text-[10px] font-semibold uppercase mb-1">Template</Text>
          <Text className="text-white text-sm leading-5">{message.content ?? '—'}</Text>
        </View>
      );

    case MessageType.LOCATION:
      return (
        <View className="flex-row items-center gap-2">
          <Text className="text-xl">📍</Text>
          <Text className="text-white text-sm">Location</Text>
        </View>
      );

    case MessageType.STICKER:
      return message.mediaUrl
        ? <Image source={{ uri: message.mediaUrl }} style={{ width: 100, height: 100 }} contentFit="contain" />
        : <Text className="text-4xl">🖼️</Text>;

    default:
      return <Text className="text-white text-sm">{message.content ?? '—'}</Text>;
  }
}

function MediaPlaceholder({ icon, label }: { icon: string; label: string }) {
  return (
    <View className="flex-row items-center gap-2 py-1">
      <Text className="text-xl">{icon}</Text>
      <Text className="text-white/70 text-sm">{label}</Text>
    </View>
  );
}

function StatusTick({ status }: { status: string }) {
  switch (status) {
    case MessageStatus.QUEUED:    return <Text className="text-white/30 text-[10px]">○</Text>;
    case MessageStatus.SENT:      return <Text className="text-white/50 text-[10px]">✓</Text>;
    case MessageStatus.DELIVERED: return <Text className="text-white/60 text-[10px]">✓✓</Text>;
    case MessageStatus.READ:      return <Text className="text-blue-400 text-[10px]">✓✓</Text>;
    case MessageStatus.FAILED:    return <Text className="text-red-400 text-[10px]">✗</Text>;
    default: return null;
  }
}
