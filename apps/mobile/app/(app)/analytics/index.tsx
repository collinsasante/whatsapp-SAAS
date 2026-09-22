import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import type { AnalyticsOverview, AnalyticsConversationsSeries } from '@whatsapp-platform/api';
import { EmptyState } from '../../../src/components/ui';
import { TrendChart } from '../../../src/components/analytics/TrendChart';
import { useAppTheme } from '../../../src/theme/useAppTheme';

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

const DATE_RANGES = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SECTION_LABEL_CLASS = 'text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-3';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

function formatSeconds(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function formatMs(ms: number | null): string {
  if (!ms) return '—';
  return formatSeconds(ms / 1000);
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <Text className="text-light-text-disabled dark:text-white/30 text-xs">—</Text>;
  if (pct === 0) return <Text className="text-light-text-disabled dark:text-white/30 text-xs">No change</Text>;
  const up = pct > 0;
  return (
    <View className="flex-row items-center gap-0.5">
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={10} color={up ? '#25D366' : '#ef4444'} />
      <Text className="text-xs font-semibold" style={{ color: up ? '#25D366' : '#ef4444' }}>{Math.abs(pct)}%</Text>
    </View>
  );
}

function AnalyticsStat({
  label, value, sub, icon, color = '#25D366', onPress,
}: {
  label: string; value: string | number; sub?: React.ReactNode;
  icon: React.ComponentProps<typeof Ionicons>['name']; color?: string; onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4"
      style={{ width: '47%' }}
      {...(onPress ? { onPress, activeOpacity: 0.8 } : {})}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: color + '20' }}>
          <Ionicons name={icon} size={14} color={color} />
        </View>
        {sub}
      </View>
      <Text className="text-light-text-primary dark:text-white font-extrabold text-2xl">{value}</Text>
      <Text className="text-light-text-muted dark:text-white/40 text-xs mt-1">{label}</Text>
    </Wrapper>
  );
}

export default function AnalyticsScreen() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { from, to } = useMemo(() => rangeForDays(days), [days]);
  const { colors, isDark } = useAppTheme();

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery({
    queryKey: ['analytics', 'overview', from, to],
    queryFn: () => apiClient.analytics.overview({ from, to }).then((r) => r.data),
  });

  const { data: series, refetch: refetchSeries } = useQuery({
    queryKey: ['analytics', 'conversations', from, to],
    queryFn: () => apiClient.analytics.conversations({ from, to }).then((r) => r.data),
  });

  const { data: teamStats, refetch: refetchTeam } = useQuery({
    queryKey: ['analytics', 'team'],
    queryFn: () => apiClient.dashboard.teamStats().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: TeamMember[] }).data ?? [])) as TeamMember[],
  });

  const isLoading = overviewLoading;
  const refetchAll = () => { refetchOverview(); refetchSeries(); refetchTeam(); };

  const o = overview as AnalyticsOverview | undefined;
  const s = series as AnalyticsConversationsSeries | undefined;

  const isEmpty = !!o && o.conversations.total === 0 && o.resolved.count === 0 && o.customers.new === 0
    && o.customers.active === 0 && o.calls.total === 0 && o.openWorkload.count === 0;

  const busiestInsight = useMemo(() => {
    if (!s || s.busiestHours.length === 0) return null;
    const top = s.busiestHours.reduce((max, h) => (h.count > max.count ? h : max), s.busiestHours[0]);
    const hour12 = top.hour % 12 === 0 ? 12 : top.hour % 12;
    const ampm = top.hour < 12 ? 'AM' : 'PM';
    return `Most conversations arrive around ${hour12} ${ampm} on ${DOW_LABELS[top.dayOfWeek]}s.`;
  }, [s]);

  const chartSeriesSlice = useMemo(() => (s ? s.series.slice(-30) : []), [s]);
  const chartData = useMemo(() => ({
    opened: chartSeriesSlice.map((p) => ({ value: p.opened })),
    resolved: chartSeriesSlice.map((p) => ({ value: p.resolved })),
  }), [chartSeriesSlice]);

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-light-border dark:border-white/5 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-2 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#25D366" />
          </TouchableOpacity>
          <Text className="text-light-text-primary dark:text-white text-xl font-bold">Analytics</Text>
        </View>
        <View className="flex-row gap-1">
          {DATE_RANGES.map((r) => (
            <TouchableOpacity
              key={r.value}
              onPress={() => setDays(r.value as 7 | 30 | 90)}
              className={`rounded-lg px-3 py-1.5 ${days === r.value ? 'bg-green' : 'bg-light-card dark:bg-surface-card'}`}
            >
              <Text className={`text-xs font-semibold ${days === r.value ? 'text-white' : 'text-light-text-muted dark:text-white/40'}`}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {o?.scope === 'agent' && (
        <View className="px-4 pt-3">
          <Text className="text-light-text-disabled dark:text-white/30 text-xs">Showing your own performance</Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetchAll} tintColor="#25D366" />}
      >
        {isEmpty ? (
          <EmptyState
            icon="bar-chart-outline"
            title="No activity yet"
            description="Analytics will appear here as your workspace receives conversations and customer activity."
          />
        ) : (
          <>
            {/* Business activity KPIs */}
            <Text className={SECTION_LABEL_CLASS}>Business Activity</Text>
            <View className="flex-row flex-wrap gap-3 mb-5">
              <AnalyticsStat
                label="Conversations" value={o?.conversations.total ?? '-'} icon="chatbubble" color="#25D366"
                sub={o ? <ChangeBadge pct={o.conversations.changePct} /> : undefined}
                onPress={() => router.push({ pathname: '/(app)/inbox', params: { tab: 'ALL' } })}
              />
              <AnalyticsStat
                label="Resolved" value={o?.resolved.count ?? '-'} icon="checkmark-circle" color="#3b82f6"
                sub={o ? <ChangeBadge pct={o.resolved.changePct} /> : undefined}
                onPress={() => router.push({ pathname: '/(app)/inbox', params: { tab: 'RESOLVED' } })}
              />
              <AnalyticsStat
                label="Currently Open" value={o?.openWorkload.count ?? '-'} icon="time" color="#f97316"
                sub={o?.resolved.rate != null ? <Text className="text-light-text-disabled dark:text-white/30 text-xs">{o.resolved.rate}% resolved</Text> : undefined}
                onPress={() => router.push({ pathname: '/(app)/inbox', params: { tab: 'PENDING' } })}
              />
              <AnalyticsStat
                label="Median First Response" value={formatSeconds(o?.medianFirstResponseSeconds ?? null)} icon="flash" color="#eab308"
              />
              <AnalyticsStat
                label="New Customers" value={o?.customers.new ?? '-'} icon="person-add" color="#3b82f6"
                sub={o ? <ChangeBadge pct={o.customers.newChangePct} /> : undefined}
                onPress={() => router.push('/(app)/contacts')}
              />
              <AnalyticsStat
                label="Active Customers" value={o?.customers.active ?? '-'} icon="people" color="#a855f7"
                sub={o ? <ChangeBadge pct={o.customers.activeChangePct} /> : undefined}
                onPress={() => router.push('/(app)/contacts')}
              />
              <AnalyticsStat
                label="Calls" value={o?.calls.total ?? '-'} icon="call" color="#a855f7"
                sub={o ? <Text className="text-light-text-disabled dark:text-white/30 text-xs">{o.calls.missed} missed</Text> : undefined}
                onPress={() => router.push('/(app)/calls')}
              />
              <AnalyticsStat
                label="CSAT" value={o?.csat.average != null ? `${o.csat.average.toFixed(1)}/5` : '—'} icon="happy" color="#ec4899"
                sub={o && o.csat.responses > 0 ? <Text className="text-light-text-disabled dark:text-white/30 text-xs">{o.csat.responses} responses</Text> : undefined}
              />
            </View>

            {/* Factual insight */}
            {busiestInsight && (
              <View className="bg-green/10 border border-green/20 rounded-xl px-4 py-3 mb-5 flex-row items-center gap-2.5">
                <Ionicons name="analytics" size={16} color="#25D366" />
                <Text className="text-green text-xs flex-1 leading-4">{busiestInsight}</Text>
              </View>
            )}

            {/* Conversation trend chart */}
            {chartData.opened.length > 1 && (
              <>
                <Text className={SECTION_LABEL_CLASS}>Conversation Trend</Text>
                <View className="bg-light-card dark:bg-surface-card rounded-2xl p-4 mb-5 border border-light-border dark:border-white/5">
                  <View className="flex-row gap-4 mb-4">
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-3 h-3 rounded-full bg-green" />
                      <Text className="text-light-text-secondary dark:text-white/50 text-xs">Opened</Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-3 h-3 rounded-full bg-blue-500" />
                      <Text className="text-light-text-secondary dark:text-white/50 text-xs">Resolved</Text>
                    </View>
                  </View>
                  <TrendChart
                    seriesA={chartData.opened.map((p) => p.value)}
                    seriesB={chartData.resolved.map((p) => p.value)}
                    colorA="#25D366"
                    colorB="#3b82f6"
                    height={120}
                  />
                  <View className="flex-row justify-between mt-2">
                    <Text className="text-light-text-disabled dark:text-white/20 text-[9px]">{formatDate(chartSeriesSlice[0]?.date ?? '')}</Text>
                    <Text className="text-light-text-disabled dark:text-white/20 text-[9px]">{formatDate(chartSeriesSlice[chartSeriesSlice.length - 1]?.date ?? '')}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Team performance */}
            {teamStats && teamStats.length > 0 && (
              <>
                <Text className={SECTION_LABEL_CLASS}>Team Performance</Text>
                <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 mb-5 overflow-hidden">
                  {teamStats.map((member, i) => (
                    <View
                      key={member.id}
                      className={`px-4 py-3.5 flex-row items-center gap-3 ${i < teamStats.length - 1 ? 'border-b border-light-border dark:border-white/5' : ''}`}
                    >
                      <View className="w-9 h-9 rounded-full bg-green/20 items-center justify-center">
                        <Text className="text-green font-bold text-sm">
                          {member.name?.charAt(0).toUpperCase() ?? '?'}
                        </Text>
                        <View
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                          style={{ backgroundColor: member.isOnline ? '#25D366' : '#6b7280', borderColor: colors.card }}
                        />
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text className="text-light-text-primary dark:text-white text-sm font-medium" numberOfLines={1}>{member.name}</Text>
                        <Text className="text-light-text-disabled dark:text-white/30 text-xs" numberOfLines={1}>{member.email}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-light-text-primary dark:text-white text-sm font-semibold">{member.resolvedToday}</Text>
                        <Text className="text-light-text-disabled dark:text-white/30 text-[10px]">resolved</Text>
                      </View>
                      <View className="items-end ml-2">
                        <Text className="text-light-text-secondary dark:text-white/60 text-xs">{formatMs(member.avgResponseMs)}</Text>
                        <Text className="text-light-text-disabled dark:text-white/20 text-[10px]">avg resp</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
