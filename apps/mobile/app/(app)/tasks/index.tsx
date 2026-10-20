import React, { useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canSendMessages } from '@whatsapp-platform/auth';
import { apiClient } from '../../../src/lib/api';
import { useAuthStore } from '../../../src/store/auth.store';
import { useAppTheme } from '../../../src/theme/useAppTheme';
import { Badge, EmptyState, ErrorState, FilterChip, type BadgeTone } from '../../../src/components/ui';

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
type Filter = TaskStatus | 'ALL';

interface Task {
  id: string;
  department: string;
  title: string;
  description: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: TaskStatus;
  conversationId: string | null;
  orderId: string | null;
  createdAt: string;
}

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'Open', value: 'OPEN' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Done', value: 'DONE' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'All', value: 'ALL' },
];

const STATUS_TONE: Record<TaskStatus, BadgeTone> = { OPEN: 'yellow', IN_PROGRESS: 'blue', DONE: 'green', CANCELLED: 'neutral' };
const PRIORITY_TONE: Record<Task['priority'], BadgeTone> = { LOW: 'neutral', NORMAL: 'neutral', HIGH: 'orange', URGENT: 'red' };

function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

/** Work handed off from Verz AI to the team (order approvals, forwarded requests, follow-ups). Mirrors the web Tasks page. */
export default function TasksScreen() {
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  // The API rejects status changes from read-only roles; hide the controls instead of showing buttons that fail.
  const canEdit = role != null && canSendMessages(role);
  const [filter, setFilter] = useState<Filter>('OPEN');

  const { data, isLoading, isError, isRefetching, refetch, error } = useQuery({
    queryKey: ['internal-tasks', filter],
    queryFn: () =>
      apiClient.internalTasks.list(filter === 'ALL' ? undefined : { status: filter }).then((r) => r.data as Task[]),
  });

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'DONE' | 'CANCELLED' }) => apiClient.internalTasks.updateStatus(id, status),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['internal-tasks'] }); },
    onError: (e) => Alert.alert('Could not update task', errorMessage(e, 'Please try again.')),
  });

  const confirmUpdate = (task: Task, status: 'DONE' | 'CANCELLED') => {
    Alert.alert(
      status === 'DONE' ? 'Mark task done?' : 'Cancel this task?',
      task.title,
      [
        { text: 'Not now', style: 'cancel' },
        { text: status === 'DONE' ? 'Mark done' : 'Cancel task', style: status === 'DONE' ? 'default' : 'destructive', onPress: () => update.mutate({ id: task.id, status }) },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-light-border dark:border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-light-text-primary dark:text-white font-semibold text-base flex-1">Tasks</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-grow-0" contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
        {FILTERS.map((f) => (
          <FilterChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </ScrollView>

      {isError && !data ? (
        <ErrorState message={errorMessage(error, 'Could not load tasks')} onRetry={() => { void refetch(); }} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />}
          ListEmptyComponent={
            isLoading ? (
              <View className="items-center pt-24"><ActivityIndicator color="#25D366" size="large" /></View>
            ) : (
              <EmptyState
                icon="clipboard-outline"
                title={`No ${filter === 'ALL' ? '' : FILTERS.find((f) => f.value === filter)?.label.toLowerCase() + ' '}tasks right now`}
                description="Work Verz AI hands off to your team shows up here."
              />
            )
          }
          renderItem={({ item }) => {
            const active = item.status === 'OPEN' || item.status === 'IN_PROGRESS';
            return (
              <View className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/5 rounded-2xl p-4">
                <View className="flex-row items-center gap-2 mb-1.5 flex-wrap">
                  <Badge label={item.status.replace('_', ' ')} tone={STATUS_TONE[item.status]} />
                  <Badge label={item.priority} tone={PRIORITY_TONE[item.priority]} />
                  <Text className="text-light-text-muted dark:text-white/40 text-xs">{item.department}</Text>
                </View>
                <Text className="text-light-text-primary dark:text-white font-semibold text-sm">{item.title}</Text>
                {item.description && (
                  <Text className="text-light-text-muted dark:text-white/50 text-xs mt-1" numberOfLines={3}>{item.description}</Text>
                )}
                <View className="flex-row items-center gap-4 mt-3">
                  {item.conversationId && (
                    <TouchableOpacity onPress={() => router.push(`/(app)/inbox/${item.conversationId}`)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                      <Text className="text-green text-xs font-semibold">View conversation</Text>
                    </TouchableOpacity>
                  )}
                  {item.orderId && (
                    <TouchableOpacity onPress={() => router.push(`/(app)/commerce/orders/${item.orderId}`)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                      <Text className="text-green text-xs font-semibold">View order</Text>
                    </TouchableOpacity>
                  )}
                  <Text className="text-light-text-muted dark:text-white/40 text-xs flex-1 text-right">{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                {canEdit && active && (
                  <View className="flex-row gap-2 mt-3">
                    <TouchableOpacity
                      onPress={() => confirmUpdate(item, 'DONE')}
                      disabled={update.isPending}
                      className="flex-1 bg-green rounded-xl py-2.5 items-center flex-row justify-center gap-1.5"
                      activeOpacity={0.8}
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text className="text-white font-semibold text-sm">Done</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmUpdate(item, 'CANCELLED')}
                      disabled={update.isPending}
                      className="flex-1 border border-light-border dark:border-white/15 rounded-xl py-2.5 items-center flex-row justify-center gap-1.5"
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
                      <Text className="text-light-text-secondary dark:text-white/60 font-semibold text-sm">Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
