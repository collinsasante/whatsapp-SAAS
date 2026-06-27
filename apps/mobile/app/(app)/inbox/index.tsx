import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useInboxStore } from '../../../src/store/inbox.store';
import type { MobileConversation } from '../../../src/store/inbox.store';

export default function InboxScreen() {
  const { conversations, setConversations } = useInboxStore();

  const { isLoading, refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await apiClient.conversations.list({ status: 'OPEN', limit: 30 });
      setConversations(res.data.data ?? res.data);
      return res.data;
    },
  });

  const openChat = (id: string) => {
    router.push(`/(app)/inbox/${id}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      {/* Header */}
      <View className="px-4 py-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold">Inbox</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ConversationRow conversation={item} onPress={() => openChat(item.id)} />
          )}
          onRefresh={refetch}
          refreshing={isLoading}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Text className="text-white/30 text-base">No conversations</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: MobileConversation;
  onPress: () => void;
}) {
  const name = conversation.contact.name ?? conversation.contact.phone;
  const initials = name.charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3 border-b border-white/5"
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Avatar */}
      <View className="w-11 h-11 rounded-full bg-green/20 items-center justify-center mr-3 flex-shrink-0">
        <Text className="text-green font-bold text-base">{initials}</Text>
      </View>

      {/* Content */}
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between mb-0.5">
          <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={1}>
            {name}
          </Text>
          {conversation.lastMessageAt && (
            <Text className="text-white/30 text-xs">
              {formatTime(conversation.lastMessageAt)}
            </Text>
          )}
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-white/40 text-xs flex-1" numberOfLines={1}>
            {conversation.channel?.name ?? 'WhatsApp'}
          </Text>
          {conversation.unreadCount > 0 && (
            <View className="bg-green rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
              <Text className="text-white text-xs font-bold">
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
