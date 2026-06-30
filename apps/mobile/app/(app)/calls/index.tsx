import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  FlatList, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface CallContact {
  id: string;
  name: string | null;
  phone: string;
  avatarUrl: string | null;
}

interface CallLog {
  id: string;
  direction: 'INCOMING' | 'OUTGOING';
  status: string;
  duration: number | null;
  phone: string;
  notes: string | null;
  isArchived: boolean;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  contact: CallContact | null;
  user: { id: string; name: string; avatarUrl: string | null } | null;
}

interface CallStats {
  total: number;
  todayTotal: number;
  missed: number;
  active: number;
  inbound: number;
  outbound: number;
}

const TABS = ['All', 'Missed', 'Incoming', 'Outgoing'] as const;

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#25D366',
  MISSED: '#ef4444',
  REJECTED: '#f97316',
  FAILED: '#ef4444',
  IN_PROGRESS: '#3b82f6',
  RINGING: '#a855f7',
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

export default function CallsScreen() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CallLog | null>(null);
  const [note, setNote] = useState('');

  const params: Record<string, unknown> = {};
  if (activeTab === 'Missed') params.status = 'MISSED';
  if (activeTab === 'Incoming') params.direction = 'INCOMING';
  if (activeTab === 'Outgoing') params.direction = 'OUTGOING';
  if (search) params.search = search;

  const { data: calls, isLoading, refetch } = useQuery({
    queryKey: ['calls', activeTab, search],
    queryFn: () => apiClient.calls.list(params).then((r) => r.data),
    select: (raw) => {
      const arr = Array.isArray(raw) ? raw : ((raw as { data: CallLog[] }).data ?? []);
      return arr as CallLog[];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['calls', 'stats'],
    queryFn: () => apiClient.calls.stats().then((r) => r.data as CallStats),
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.calls.addNote(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calls'] });
      setNote('');
      Alert.alert('Saved', 'Note added to call.');
    },
    onError: () => Alert.alert('Error', 'Failed to save note.'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiClient.calls.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calls'] });
      setSelected(null);
    },
  });

  const renderCallRow = ({ item }: { item: CallLog }) => {
    const isIncoming = item.direction === 'INCOMING';
    const statusColor = STATUS_COLOR[item.status] ?? '#fff';
    const displayName = item.contact?.name ?? item.contact?.phone ?? item.phone;

    return (
      <TouchableOpacity
        className="flex-row items-center px-4 py-3.5 border-b border-white/5"
        onPress={() => setSelected(item)}
        activeOpacity={0.7}
      >
        {/* Direction icon */}
        <View className="w-9 h-9 rounded-full bg-surface-card items-center justify-center mr-3">
          <Ionicons
            name={isIncoming ? 'call-outline' : 'arrow-up-outline'}
            size={16}
            color={isIncoming ? '#25D366' : '#a855f7'}
          />
        </View>

        <View className="flex-1 min-w-0">
          <Text className="text-white font-medium text-sm" numberOfLines={1}>{displayName}</Text>
          <View className="flex-row items-center gap-2 mt-0.5">
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: statusColor + '20' }}>
              <Text className="text-[10px] font-semibold" style={{ color: statusColor }}>
                {item.status}
              </Text>
            </View>
            <Text className="text-white/30 text-xs">{formatDuration(item.duration)}</Text>
          </View>
        </View>

        <Text className="text-white/30 text-xs">{timeAgo(item.startedAt)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold">Calls</Text>
      </View>

      {/* Stats */}
      {stats && (
        <View className="flex-row px-4 py-3 gap-2">
          {[
            { label: 'Total', value: stats.total, color: '#fff' },
            { label: 'Missed', value: stats.missed, color: '#ef4444' },
            { label: 'In', value: stats.inbound, color: '#25D366' },
            { label: 'Out', value: stats.outbound, color: '#a855f7' },
          ].map((s) => (
            <View key={s.label} className="flex-1 bg-surface-card rounded-xl p-3 items-center">
              <Text className="text-lg font-bold" style={{ color: s.color }}>{s.value}</Text>
              <Text className="text-white/40 text-[10px] font-medium mt-0.5">{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Search */}
      <View className="px-4 pb-2">
        <View className="bg-surface-card rounded-xl flex-row items-center px-3">
          <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.3)" />
          <TextInput
            className="flex-1 py-2.5 px-2 text-white text-sm"
            placeholder="Search calls..."
            placeholderTextColor="rgba(255,255,255,0.2)"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.3)" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 mb-2" contentContainerStyle={{ gap: 8 }}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-1.5 ${activeTab === tab ? 'bg-green' : 'bg-surface-card'}`}
          >
            <Text className={`text-sm font-semibold ${activeTab === tab ? 'text-white' : 'text-white/40'}`}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <FlatList
          data={calls ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderCallRow}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25D366" />}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Ionicons name="call-outline" size={40} color="rgba(255,255,255,0.15)" />
              <Text className="text-white/30 text-sm mt-3">No calls found</Text>
            </View>
          }
        />
      )}

      {/* Detail modal */}
      <Modal visible={!!selected} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-surface rounded-t-3xl p-6" style={{ maxHeight: '80%' }}>
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white text-lg font-bold">
                {selected?.contact?.name ?? selected?.phone ?? 'Unknown'}
              </Text>
              <TouchableOpacity onPress={() => { setSelected(null); setNote(''); }}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            {selected && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Call info grid */}
                <View className="bg-surface-card rounded-2xl p-4 mb-4">
                  {[
                    { label: 'Status', value: selected.status },
                    { label: 'Direction', value: selected.direction },
                    { label: 'Duration', value: formatDuration(selected.duration) },
                    { label: 'Agent', value: selected.user?.name ?? '-' },
                    { label: 'End Reason', value: selected.endReason ?? '-' },
                  ].map((row) => (
                    <View key={row.label} className="flex-row justify-between py-2 border-b border-white/5 last:border-0">
                      <Text className="text-white/40 text-sm">{row.label}</Text>
                      <Text className="text-white text-sm font-medium">{row.value}</Text>
                    </View>
                  ))}
                </View>

                {/* Notes */}
                {selected.notes && (
                  <View className="bg-surface-card rounded-2xl p-4 mb-4">
                    <Text className="text-white/40 text-xs mb-2">Call Notes</Text>
                    <Text className="text-white text-sm">{selected.notes}</Text>
                  </View>
                )}

                {/* Add note */}
                <View className="bg-surface-card rounded-2xl p-4 mb-4">
                  <Text className="text-white/40 text-xs mb-2">Add Internal Note</Text>
                  <TextInput
                    className="text-white text-sm min-h-[60px]"
                    placeholder="Type a note..."
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    value={note}
                    onChangeText={setNote}
                    multiline
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    className="bg-green/20 rounded-xl py-2 items-center mt-2"
                    onPress={() => {
                      if (!note.trim()) return;
                      addNoteMutation.mutate({ id: selected.id, content: note.trim() });
                    }}
                    disabled={addNoteMutation.isPending || !note.trim()}
                  >
                    <Text className="text-green text-sm font-semibold">Save Note</Text>
                  </TouchableOpacity>
                </View>

                {/* Actions */}
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    className="flex-1 bg-surface-card rounded-xl py-3 items-center"
                    onPress={() => archiveMutation.mutate(selected.id)}
                  >
                    <Text className="text-white/50 text-sm">Archive</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
