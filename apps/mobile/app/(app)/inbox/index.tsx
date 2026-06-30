import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useInboxStore } from '../../../src/store/inbox.store';
import type { MobileConversation } from '../../../src/store/inbox.store';
import { useAuthStore } from '../../../src/store/auth.store';
import { MessageDirection } from '@whatsapp-platform/shared-types';

type InboxTab = 'ALL' | 'MINE' | 'PENDING' | 'REQUESTED' | 'RESOLVED';

const TABS: { key: InboxTab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'MINE', label: 'Mine' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'REQUESTED', label: 'Requested' },
  { key: 'RESOLVED', label: 'Resolved' },
];

function tabToParams(
  tab: InboxTab,
  userId: string | undefined,
  search: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = { limit: 30 };
  if (search.trim()) base.search = search.trim();
  if (tab === 'MINE') {
    base.status = 'OPEN';
    if (userId) base.assignedToId = userId;
  } else if (tab !== 'ALL') {
    base.status = tab;
  }
  return base;
}

export default function InboxScreen() {
  const [activeTab, setActiveTab] = useState<InboxTab>('ALL');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const { conversations, setConversations } = useInboxStore();
  const userId = useAuthStore((s) => s.user?.id);

  const params = tabToParams(activeTab, userId, search);

  const { data: _fetchedConvs, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['conversations', activeTab, search],
    queryFn: async () => {
      const res = await apiClient.conversations.list(params);
      return (res.data.data ?? res.data) as MobileConversation[];
    },
    staleTime: 30_000,
  });

  // Sync fetched conversations into Zustand store via effect (safe — runs after render)
  useEffect(() => {
    if (_fetchedConvs) {
      setConversations(_fetchedConvs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_fetchedConvs]);

  const handleTabPress = useCallback(
    (tab: InboxTab) => {
      setActiveTab(tab);
      setSearch('');
    },
    [],
  );

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      {/* Header */}
      <View className="px-4 pt-2 pb-0">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-white text-xl font-bold">Inbox</Text>
          <TouchableOpacity
            onPress={() => {
              setShowSearch((v) => !v);
              if (showSearch) setSearch('');
            }}
            className="w-8 h-8 items-center justify-center"
          >
            <Ionicons name={showSearch ? 'close' : 'search'} size={20} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>

        {showSearch && (
          <TextInput
            className="bg-surface-card border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm mb-3"
            placeholder="Search contacts or messages..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={search}
            onChangeText={setSearch}
            autoFocus
            returnKeyType="search"
          />
        )}

        {/* Tabs */}
        <View className="flex-row gap-1 mb-1">
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => handleTabPress(tab.key)}
              className={`px-3 py-1.5 rounded-full ${
                activeTab === tab.key ? 'bg-green' : 'bg-white/5'
              }`}
              activeOpacity={0.7}
            >
              <Text
                className={`text-xs font-semibold ${
                  activeTab === tab.key ? 'text-white' : 'text-white/40'
                }`}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View className="h-px bg-white/5" />

      {isLoading && !isRefetching ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              onPress={() => router.push(`/(app)/inbox/${item.id}`)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#25D366"
            />
          }
          ListEmptyComponent={
            <View className="items-center justify-center pt-24">
              <Ionicons name="chatbubbles-outline" size={48} color="rgba(255,255,255,0.15)" style={{ marginBottom: 12 }} />
              <Text className="text-white/30 text-base font-medium">No conversations</Text>
            </View>
          }
          contentContainerStyle={{ flexGrow: 1 }}
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
  const name = conversation.contact?.name ?? conversation.contact?.phone ?? 'Unknown';
  const initials = name.charAt(0).toUpperCase();
  const lastMsg = conversation.lastMessage ?? (conversation as { messages?: Array<{ content: string | null; type: string; direction: string }> }).messages?.[0];

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-white/5"
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Avatar */}
      <View className="w-12 h-12 rounded-full bg-green/15 items-center justify-center mr-3 flex-shrink-0 border border-green/20">
        <Text className="text-green font-bold text-lg">{initials}</Text>
      </View>

      {/* Content */}
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between mb-0.5">
          <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={1}>
            {name}
          </Text>
          {conversation.lastMessageAt && (
            <Text className="text-white/30 text-xs flex-shrink-0">
              {formatTime(conversation.lastMessageAt)}
            </Text>
          )}
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-white/40 text-xs flex-1 mr-2" numberOfLines={1}>
            {lastMsg
              ? formatLastMessage(lastMsg)
              : (conversation.channel?.name ?? 'WhatsApp')}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {conversation.status === 'PENDING' && (
              <View className="w-2 h-2 rounded-full bg-orange-400" />
            )}
            {conversation.status === 'REQUESTED' && (
              <View className="w-2 h-2 rounded-full bg-blue-400" />
            )}
            {conversation.unreadCount > 0 && (
              <View className="bg-green rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                <Text className="text-white text-[10px] font-bold">
                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function formatLastMessage(msg: { content: string | null; type: string; direction: string }): string {
  const prefix = msg.direction === MessageDirection.OUTBOUND ? 'You: ' : '';
  if (msg.content) return prefix + msg.content;
  switch (msg.type) {
    case 'IMAGE': return prefix + '📷 Photo';
    case 'VIDEO': return prefix + '🎬 Video';
    case 'AUDIO': return prefix + '🎵 Voice message';
    case 'DOCUMENT': return prefix + '📄 Document';
    case 'TEMPLATE': return prefix + '📋 Template';
    case 'LOCATION': return prefix + '📍 Location';
    case 'STICKER': return prefix + '🖼️ Sticker';
    default: return prefix + 'Message';
  }
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
