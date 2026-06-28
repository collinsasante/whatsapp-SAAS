import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiClient.notifications.list(50).then((r) => r.data as Notification[]),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.notifications.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.notifications.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = (data ?? []).filter((n) => !n.isRead).length;

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <Text className="text-green text-sm font-medium">Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#25D366"
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className={`px-4 py-4 border-b border-white/5 flex-row items-start gap-3 ${
                !item.isRead ? 'bg-green/5' : ''
              }`}
              onPress={() => {
                if (!item.isRead) markRead.mutate(item.id);
              }}
              activeOpacity={0.7}
            >
              {!item.isRead && (
                <View className="w-2 h-2 rounded-full bg-green mt-1.5 flex-shrink-0" />
              )}
              {item.isRead && <View className="w-2" />}
              <View className="flex-1 min-w-0">
                <Text className="text-white font-semibold text-sm mb-0.5" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-white/60 text-xs leading-4" numberOfLines={2}>
                  {item.body}
                </Text>
                <Text className="text-white/30 text-[10px] mt-1.5">
                  {formatRelative(item.createdAt)}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center pt-24">
              <Text className="text-white/20 text-4xl mb-3">🔔</Text>
              <Text className="text-white/30 text-base font-medium">No notifications</Text>
            </View>
          }
          contentContainerStyle={{ flexGrow: 1 }}
        />
      )}
    </SafeAreaView>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
