import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useInboxStore } from '../../../src/store/inbox.store';
import type { Message } from '@whatsapp-platform/shared-types';
import { MessageDirection, MessageType } from '@whatsapp-platform/shared-types';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { messages, setMessages, addMessage } = useInboxStore();
  const chatMessages = messages[id] ?? [];

  const { isLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const res = await apiClient.messages.list(id, { limit: 50 });
      const msgs: Message[] = res.data.data ?? res.data;
      setMessages(id, msgs.reverse());
      return msgs;
    },
    enabled: !!id,
  });

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
      content,
      type: MessageType.TEXT,
      direction: MessageDirection.OUTBOUND,
      status: 'QUEUED' as never,
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
      senderId: null,
      sender: null,
      whatsappMessageId: null,
    };

    addMessage(id, optimisticMsg);

    try {
      await apiClient.messages.send(id, { type: 'TEXT', content });
    } catch {
      // message failed — in Phase 4 we'll handle the retry queue
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (chatMessages.length > 0) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, [chatMessages.length]);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Chat</Text>
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
          contentContainerStyle={{ padding: 16, gap: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-row items-end px-4 py-3 border-t border-white/5 gap-3">
          <TextInput
            className="flex-1 bg-surface-card rounded-2xl px-4 py-3 text-white text-base max-h-32"
            placeholder="Type a message..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={text}
            onChangeText={setText}
            multiline
            onSubmitEditing={sendMessage}
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
    <View
      className={`max-w-[80%] ${isOutbound ? 'self-end' : 'self-start'}`}
    >
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isOutbound ? 'bg-green rounded-br-sm' : 'bg-surface-card rounded-bl-sm'
        }`}
      >
        {message.type === MessageType.TEXT && (
          <Text className="text-white text-sm leading-5">{message.content}</Text>
        )}
        {message.type === MessageType.NOTE && (
          <Text className="text-yellow-300 text-sm italic leading-5">
            📝 {message.content}
          </Text>
        )}
      </View>
      <Text className={`text-white/30 text-xs mt-1 ${isOutbound ? 'text-right' : 'text-left'}`}>
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
    </View>
  );
}
