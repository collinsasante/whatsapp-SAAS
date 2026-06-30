import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface DashboardOverview {
  openConversations: number;
  pendingConversations: number;
  resolvedToday: number;
  totalContacts: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  assignedConversations: number;
  activeConversations: number;
  resolvedToday: number;
  isOnline: boolean;
  avgResponseMs: number | null;
}

interface TrendPoint {
  date: string;
  opened: number;
  resolved: number;
}

interface CallStats {
  total: number;
  missed: number;
  inbound: number;
  outbound: number;
  todayTotal: number;
}

const DATE_RANGES = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

function formatMs(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

export default function AnalyticsScreen() {
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => apiClient.dashboard.overview().then((r) => r.data as DashboardOverview | { data: DashboardOverview }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: DashboardOverview }).data : raw) as DashboardOverview,
  });

  const { data: teamStats, refetch: refetchTeam } = useQuery({
    queryKey: ['analytics', 'team'],
    queryFn: () => apiClient.dashboard.teamStats().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: TeamMember[] }).data ?? [])) as TeamMember[],
  });

  const { data: trend, refetch: refetchTrend } = useQuery({
    queryKey: ['analytics', 'trend', days],
    queryFn: () => apiClient.dashboard.conversationTrend(days).then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: TrendPoint[] }).data ?? [])) as TrendPoint[],
  });

  const { data: callStats, refetch: refetchCalls } = useQuery({
    queryKey: ['analytics', 'calls'],
    queryFn: () => apiClient.calls.stats().then((r) => r.data as CallStats | { data: CallStats }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: CallStats }).data : raw) as CallStats,
  });

  const isLoading = overviewLoading;
  const refetchAll = () => { refetchOverview(); refetchTeam(); refetchTrend(); refetchCalls(); };

  // Mini bar chart — compute max then render proportional bars
  const maxVal = trend ? Math.max(...trend.map((p) => Math.max(p.opened, p.resolved)), 1) : 1;
  const trendSlice = (trend ?? []).slice(-14); // last 14 days

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">Analytics</Text>
        <View className="flex-row gap-1">
          {DATE_RANGES.map((r) => (
            <TouchableOpacity
              key={r.value}
              onPress={() => setDays(r.value as 7 | 30 | 90)}
              className={`rounded-lg px-3 py-1.5 ${days === r.value ? 'bg-green' : 'bg-surface-card'}`}
            >
              <Text className={`text-xs font-semibold ${days === r.value ? 'text-white' : 'text-white/40'}`}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetchAll} tintColor="#25D366" />}
      >
        {/* Overview KPIs */}
        <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
          Conversations
        </Text>
        <View className="flex-row flex-wrap gap-3 mb-5">
          {[
            { label: 'Open', value: overview?.openConversations ?? '-', color: '#25D366', icon: 'chatbubble' },
            { label: 'Pending', value: overview?.pendingConversations ?? '-', color: '#f97316', icon: 'time' },
            { label: 'Resolved Today', value: overview?.resolvedToday ?? '-', color: '#3b82f6', icon: 'checkmark-circle' },
            { label: 'Contacts', value: overview?.totalContacts ?? '-', color: '#a855f7', icon: 'people' },
          ].map((stat) => (
            <View
              key={stat.label}
              className="bg-surface-card rounded-2xl p-4 border border-white/5"
              style={{ width: '47%' }}
            >
              <Ionicons name={stat.icon as any} size={18} color={stat.color} />
              <Text className="text-2xl font-extrabold mt-2" style={{ color: stat.color }}>
                {stat.value}
              </Text>
              <Text className="text-white/40 text-xs mt-1">{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Call Stats */}
        {callStats && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Calls
            </Text>
            <View className="flex-row gap-2 mb-5">
              {[
                { label: 'Total', value: callStats.total, color: '#fff' },
                { label: 'Missed', value: callStats.missed, color: '#ef4444' },
                { label: 'Inbound', value: callStats.inbound, color: '#25D366' },
                { label: 'Outbound', value: callStats.outbound, color: '#a855f7' },
              ].map((s) => (
                <View key={s.label} className="flex-1 bg-surface-card rounded-xl p-3 items-center">
                  <Text className="text-base font-bold" style={{ color: s.color }}>{s.value}</Text>
                  <Text className="text-white/40 text-[10px] mt-0.5">{s.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Conversation trend chart */}
        {trendSlice.length > 0 && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Conversation Trend (last {days} days)
            </Text>
            <View className="bg-surface-card rounded-2xl p-4 mb-5 border border-white/5">
              {/* Legend */}
              <View className="flex-row gap-4 mb-4">
                <View className="flex-row items-center gap-1.5">
                  <View className="w-3 h-3 rounded-full bg-green" />
                  <Text className="text-white/50 text-xs">Opened</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <View className="w-3 h-3 rounded-full bg-blue-500" />
                  <Text className="text-white/50 text-xs">Resolved</Text>
                </View>
              </View>

              {/* Bar chart */}
              <View className="flex-row items-end gap-1" style={{ height: 80 }}>
                {trendSlice.map((p, i) => {
                  const openH = Math.max((p.opened / maxVal) * 72, 2);
                  const resH = Math.max((p.resolved / maxVal) * 72, 2);
                  return (
                    <View key={i} className="flex-1 items-center justify-end gap-0.5" style={{ height: 80 }}>
                      <View className="flex-row gap-0.5 items-end">
                        <View
                          style={{ width: 4, height: openH, backgroundColor: '#25D366', borderRadius: 2 }}
                        />
                        <View
                          style={{ width: 4, height: resH, backgroundColor: '#3b82f6', borderRadius: 2 }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Date labels — only first, middle, last */}
              <View className="flex-row justify-between mt-2">
                <Text className="text-white/20 text-[9px]">{formatDate(trendSlice[0]?.date ?? '')}</Text>
                <Text className="text-white/20 text-[9px]">
                  {formatDate(trendSlice[Math.floor(trendSlice.length / 2)]?.date ?? '')}
                </Text>
                <Text className="text-white/20 text-[9px]">
                  {formatDate(trendSlice[trendSlice.length - 1]?.date ?? '')}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Team performance */}
        {teamStats && teamStats.length > 0 && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Team Performance
            </Text>
            <View className="bg-surface-card rounded-2xl border border-white/5 mb-5 overflow-hidden">
              {teamStats.map((member, i) => (
                <View
                  key={member.id}
                  className={`px-4 py-3.5 flex-row items-center gap-3 ${i < teamStats.length - 1 ? 'border-b border-white/5' : ''}`}
                >
                  <View className="w-9 h-9 rounded-full bg-green/20 items-center justify-center">
                    <Text className="text-green font-bold text-sm">
                      {member.name?.charAt(0).toUpperCase() ?? '?'}
                    </Text>
                    {/* Online indicator */}
                    <View
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-card"
                      style={{ backgroundColor: member.isOnline ? '#25D366' : '#6b7280' }}
                    />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-white text-sm font-medium" numberOfLines={1}>{member.name}</Text>
                    <Text className="text-white/30 text-xs" numberOfLines={1}>{member.email}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-white text-sm font-semibold">{member.resolvedToday}</Text>
                    <Text className="text-white/30 text-[10px]">resolved</Text>
                  </View>
                  <View className="items-end ml-2">
                    <Text className="text-white/60 text-xs">{formatMs(member.avgResponseMs)}</Text>
                    <Text className="text-white/20 text-[10px]">avg resp</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
