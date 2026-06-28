import React, { useEffect, useRef, useState, useCallback } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useInboxStore } from '../../../src/store/inbox.store';
import { useAuthStore } from '../../../src/store/auth.store';
import type { Message } from '@whatsapp-platform/shared-types';
import { MessageDirection, MessageType, MessageStatus } from '@whatsapp-platform/shared-types';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { messages, hasMoreMessages, messageCursors, setMessages, addMessage, prependMessages, setMessageCursor, updateConversation } = useInboxStore();
  const chatMessages = messages[id] ?? [];
  const hasMore = hasMoreMessages[id] ?? false;
  const cursor = messageCursors[id] ?? null;

  const conversations = useInboxStore((s) => s.conversations);
  const conversation = conversations.find((c) => c.id === id);
  const contactName = conversation?.contact.name ?? conversation?.contact.phone ?? 'Chat';

  const userId = useAuthStore((s) => s.user?.id);
  const typingUsers = useInboxStore((s) => s.typingUsers[id] ?? []);

  // Initial messages fetch
  const { isLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const res = await apiClient.messages.list(id, { limit: 50 });
      const result = res.data as { data: Message[]; hasMore?: boolean };
      const msgs = result.data ?? (res.data as Message[]);
      setMessages(id, msgs, result.hasMore ?? false);
      return msgs;
    },
    enabled: !!id,
  });

  // Mark conversation as read when opened
  useEffect(() => {
    if (id) {
      apiClient.conversations.markRead(id).catch(() => null);
      updateConversation(id, { unreadCount: 0 });
    }
  }, [id, updateConversation]);

  const loadOlderMessages = useCallback(async () => {
    if (!hasMore || !cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await apiClient.messages.list(id, { limit: 50, before: cursor });
      const result = res.data as { data: Message[]; hasMore?: boolean };
      const older = result.data ?? [];
      if (older.length > 0) {
        prependMessages(id, older);
        setMessageCursor(id, new Date(older[0].createdAt).toISOString(), result.hasMore ?? false);
      } else {
        setMessageCursor(id, null, false);
      }
    } catch {
      // silently fail — user can try again
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, cursor, id, isLoadingMore, prependMessages, setMessageCursor]);

  const sendMessage = async () => {
    const content = text.trim();
    if (!content || isSending) return;

    setText('');
    setIsSending(true);

    const optimisticMsg: Message = {
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
      mediaUrl: null,
      mediaType: null,
      mediaSize: null,
      mediaCaption: null,
      templateId: null,
      templateVariables: null,
      metadata: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      failureReason: null,
      replyToId: null,
      replyTo: null,
      isStarred: false,
      isPinned: false,
      isEdited: false,
      editedAt: null,
      deletedForEveryone: false,
      deletedAt: null,
      whatsappMessageId: null,
    };

    addMessage(id, optimisticMsg);

    try {
      await apiClient.messages.send(id, { type: 'TEXT', content });
    } catch {
      // Phase 6: retry queue
    } finally {
      setIsSending(false);
    }
  };

  const showActions = () => {
    const status = conversation?.status ?? 'OPEN';
    const options =
      Platform.OS === 'ios'
        ? buildActionOptions(status)
        : buildActionOptions(status);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), 'Cancel'],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: options.findIndex((o) => o.destructive),
        },
        (index) => {
          if (index < options.length) options[index]?.action();
        },
      );
    } else {
      Alert.alert(
        'Conversation',
        undefined,
        [
          ...options.map((o) => ({
            text: o.label,
            style: o.destructive ? ('destructive' as const) : ('default' as const),
            onPress: o.action,
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    }
  };

  function buildActionOptions(status: string) {
    const actions: { label: string; destructive?: boolean; action: () => void }[] = [];
    if (status === 'OPEN' || status === 'PENDING') {
      actions.push({
        label: 'Resolve conversation',
        action: async () => {
          try {
            await apiClient.conversations.resolve(id);
            updateConversation(id, { status: 'RESOLVED' });
            router.back();
          } catch {
            Alert.alert('Error', 'Could not resolve conversation');
          }
        },
      });
    }
    if (status === 'RESOLVED') {
      actions.push({
        label: 'Reopen conversation',
        action: async () => {
          try {
            await apiClient.conversations.reopen(id);
            updateConversation(id, { status: 'OPEN' });
          } catch {
            Alert.alert('Error', 'Could not reopen conversation');
          }
        },
      });
    }
    actions.push({
      label: 'Archive',
      destructive: true,
      action: async () => {
        try {
          await apiClient.conversations.archive(id);
          updateConversation(id, { status: 'ARCHIVED' as never });
          router.back();
        } catch {
          Alert.alert('Error', 'Could not archive conversation');
        }
      },
    });
    return actions;
  }

  useEffect(() => {
    if (chatMessages.length > 0 && !isLoadingMore) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, [chatMessages.length, isLoadingMore]);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <View className="flex-1 min-w-0">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {contactName}
          </Text>
          {typingUsers.length > 0 && (
            <Text className="text-green text-xs">typing...</Text>
          )}
        </View>
        <TouchableOpacity onPress={showActions} className="ml-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-white/50 text-xl">⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ padding: 12 }}
          onContentSizeChange={() => {
            if (!isLoadingMore) listRef.current?.scrollToEnd({ animated: false });
          }}
          ListHeaderComponent={
            hasMore ? (
              <TouchableOpacity
                className="items-center py-3"
                onPress={loadOlderMessages}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <ActivityIndicator color="#25D366" size="small" />
                ) : (
                  <Text className="text-green text-xs font-medium">Load older messages</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View className="flex-row items-end px-4 py-3 border-t border-white/5 gap-3">
          <TextInput
            className="flex-1 bg-surface-card rounded-2xl px-4 py-3 text-white text-base max-h-32"
            placeholder="Type a message..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            className="w-11 h-11 rounded-full bg-green items-center justify-center"
            onPress={sendMessage}
            disabled={!text.trim() || isSending}
            activeOpacity={0.8}
            style={{ opacity: !text.trim() || isSending ? 0.5 : 1 }}
          >
            <Text className="text-white font-bold text-base">↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === MessageDirection.OUTBOUND;

  return (
    <View className={`mb-2 max-w-[80%] ${isOutbound ? 'self-end' : 'self-start'}`}>
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isOutbound
            ? 'bg-green rounded-br-sm'
            : message.type === MessageType.NOTE
            ? 'bg-yellow-900/40 border border-yellow-600/30 rounded-bl-sm'
            : 'bg-surface-card rounded-bl-sm'
        }`}
      >
        <MessageContent message={message} />
      </View>
      <View className={`flex-row items-center mt-1 gap-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
        <Text className="text-white/30 text-[10px]">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
        {isOutbound && <StatusTick status={message.status} />}
      </View>
    </View>
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.type) {
    case MessageType.TEXT:
      return <Text className="text-white text-sm leading-5">{message.content}</Text>;

    case MessageType.NOTE:
      return (
        <View className="flex-row items-start gap-1.5">
          <Text className="text-yellow-400 text-sm">📝</Text>
          <Text className="text-yellow-100 text-sm leading-5 italic flex-1">{message.content}</Text>
        </View>
      );

    case MessageType.IMAGE:
      return message.mediaUrl ? (
        <View>
          <Image
            source={{ uri: message.mediaUrl }}
            style={{ width: 200, height: 150, borderRadius: 8 }}
            contentFit="cover"
          />
          {message.mediaCaption && (
            <Text className="text-white text-xs mt-1.5">{message.mediaCaption}</Text>
          )}
        </View>
      ) : (
        <MediaPlaceholder icon="📷" label="Photo" />
      );

    case MessageType.VIDEO:
      return (
        <View>
          {message.mediaUrl ? (
            <View className="w-[200px] h-[150px] rounded-lg bg-black/40 items-center justify-center">
              <Text className="text-4xl">▶️</Text>
            </View>
          ) : (
            <MediaPlaceholder icon="🎬" label="Video" />
          )}
          {message.mediaCaption && (
            <Text className="text-white text-xs mt-1.5">{message.mediaCaption}</Text>
          )}
        </View>
      );

    case MessageType.AUDIO:
      return (
        <View className="flex-row items-center gap-2 min-w-[140px]">
          <Text className="text-2xl">🎵</Text>
          <View className="flex-1">
            <Text className="text-white text-xs font-medium">Voice message</Text>
            {message.mediaSize != null && (
              <Text className="text-white/40 text-[10px]">{formatBytes(message.mediaSize)}</Text>
            )}
          </View>
        </View>
      );

    case MessageType.DOCUMENT:
      return (
        <View className="flex-row items-center gap-2 min-w-[160px]">
          <Text className="text-2xl">📄</Text>
          <View className="flex-1 min-w-0">
            <Text className="text-white text-xs font-medium" numberOfLines={2}>
              {message.content ?? 'Document'}
            </Text>
            {message.mediaSize != null && (
              <Text className="text-white/40 text-[10px]">{formatBytes(message.mediaSize)}</Text>
            )}
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
      return message.mediaUrl ? (
        <Image
          source={{ uri: message.mediaUrl }}
          style={{ width: 100, height: 100 }}
          contentFit="contain"
        />
      ) : (
        <Text className="text-4xl">🖼️</Text>
      );

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
    case MessageStatus.QUEUED:
      return <Text className="text-white/30 text-[10px]">○</Text>;
    case MessageStatus.SENT:
      return <Text className="text-white/50 text-[10px]">✓</Text>;
    case MessageStatus.DELIVERED:
      return <Text className="text-white/60 text-[10px]">✓✓</Text>;
    case MessageStatus.READ:
      return <Text className="text-blue-400 text-[10px]">✓✓</Text>;
    case MessageStatus.FAILED:
      return <Text className="text-red-400 text-[10px]">✗</Text>;
    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
