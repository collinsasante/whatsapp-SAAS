import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';
import { socketClient } from '../../src/lib/socket';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Overview {
  contacts?: { total: number; open: number; assigned: number; unassigned: number };
  conversations?: { total: number; open: number; pending: number; resolved: number };
  business?: { name: string; phone: string; email?: string; address?: string; website?: string; plan?: string };
  openCount?: number;
  pendingCount?: number;
  resolvedCount?: number;
  aiHandledCount?: number;
  avgConfidence?: number | null;
  escalatedCount?: number;
}

interface TeamMember {
  id: string;
  name: string;
  assignedConversations: number;
  resolvedToday: number;
  isOnline: boolean;
}

interface WaStatus {
  isConfigured: boolean;
  isConnected: boolean;
  qualityRating: string;
  messagingLimit: string;
  verificationStatus: string;
}

interface ConvStats { opened: number; closed: number }

type DatePreset = 'today' | '7d' | '30d';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().split('T')[0]!; }
function daysAgoISO(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0]!;
}

const PRESETS: { key: DatePreset; label: string; from: () => string }[] = [
  { key: 'today', label: 'Today', from: todayISO },
  { key: '7d',    label: '7 Days', from: () => daysAgoISO(7) },
  { key: '30d',   label: '30 Days', from: () => daysAgoISO(30) },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View className="flex-row items-center gap-2 mb-3">
      <Ionicons name={icon as never} size={15} color="#25D366" />
      <Text className="text-white font-semibold text-sm">{title}</Text>
    </View>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`bg-surface-card rounded-2xl p-4 border border-white/5 ${className ?? ''}`}>
      {children}
    </View>
  );
}

function QuickStat({
  label, value, color,
}: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 bg-surface-card rounded-2xl p-4 border border-white/5 items-center">
      <Text className="font-extrabold text-2xl" style={{ color }}>
        {value.toLocaleString()}
      </Text>
      <Text className="text-white/40 text-xs mt-1 text-center">{label}</Text>
    </View>
  );
}

function QuickAction({
  label, icon, color, onPress,
}: { label: string; icon: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity className="flex-1 items-center gap-2" onPress={onPress} activeOpacity={0.75}>
      <View
        className="w-14 h-14 rounded-2xl items-center justify-center"
        style={{ backgroundColor: `${color}18` }}
      >
        <Ionicons name={icon as never} size={22} color={color} />
      </View>
      <Text className="text-white/60 text-[11px] font-medium">{label}</Text>
    </TouchableOpacity>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const qc = useQueryClient();

  const [preset, setPreset] = useState<DatePreset>('30d');
  const [statsFrom, setStatsFrom] = useState(() => daysAgoISO(30));

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data fetches ────────────────────────────────────────────────────────────

  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => apiClient.dashboard.overview().then((r) => r.data as Overview),
    throwOnError: false,
  });

  const { data: team = [], isLoading: loadingTeam, refetch: refetchTeam } = useQuery({
    queryKey: ['dashboard', 'team'],
    queryFn: () => apiClient.dashboard.teamStats().then((r) => r.data as TeamMember[]),
    throwOnError: false,
  });

  const { data: waStatus, isLoading: loadingWa } = useQuery({
    queryKey: ['dashboard', 'waStatus'],
    queryFn: () => apiClient.dashboard.whatsappStatus().then((r) => r.data as WaStatus),
    throwOnError: false,
  });

  const { data: convStats, isLoading: loadingStats } = useQuery({
    queryKey: ['dashboard', 'convStats', statsFrom],
    queryFn: () =>
      apiClient.dashboard.conversationStats(statsFrom, todayISO()).then((r) => r.data as ConvStats),
    throwOnError: false,
  });

  const isLoading = loadingOverview;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  // ── Real-time socket updates ────────────────────────────────────────────────

  const refreshOverview = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void refetchOverview();
      void refetchTeam();
    }, 600);
  }, [refetchOverview, refetchTeam]);

  useEffect(() => {
    socketClient.on('conversation:updated', refreshOverview);
    socketClient.on('conversation:state_changed', refreshOverview);
    socketClient.on('message:new', refreshOverview);
    return () => {
      socketClient.off('conversation:updated', refreshOverview);
      socketClient.off('conversation:state_changed', refreshOverview);
      socketClient.off('message:new', refreshOverview);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [refreshOverview]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const openCount = overview?.conversations?.open ?? overview?.openCount ?? 0;
  const pendingCount = overview?.conversations?.pending ?? overview?.pendingCount ?? 0;
  const resolvedCount = overview?.conversations?.resolved ?? overview?.resolvedCount ?? 0;
  const contactsTotal = overview?.contacts?.total ?? 0;
  const resolvedToday = team.reduce((a, m) => a + (m.resolvedToday ?? 0), 0);
  const biz = overview?.business;

  // ── Preset selection ────────────────────────────────────────────────────────

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const found = PRESETS.find((x) => x.key === p);
    if (found) setStatsFrom(found.from());
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#25D366" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-1">
            <Text className="text-white/40 text-xs mb-0.5">{tenant?.name ?? 'Workspace'}</Text>
            <Text className="text-white text-xl font-bold">
              {greeting()}, {user?.name?.split(' ')[0] ?? 'Agent'} 👋
            </Text>
            {biz?.plan && (
              <View className="mt-1.5 self-start bg-green/15 rounded-full px-2.5 py-0.5 border border-green/20">
                <Text className="text-green text-[10px] font-semibold">{biz.plan} Plan</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            className="w-9 h-9 bg-surface-card border border-white/10 rounded-xl items-center justify-center"
          >
            <Ionicons name="refresh-outline" size={18} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color="#25D366" size="large" />
          </View>
        ) : (
          <>
            {/* ── No channel banner ──────────────────────────────────────── */}
            {waStatus && !waStatus.isConnected && (
              <View className="bg-green/10 border border-green/20 rounded-2xl p-4 flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-xl bg-green items-center justify-center flex-shrink-0">
                  <Ionicons name="logo-whatsapp" size={22} color="#fff" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-white font-semibold text-sm">No channel connected</Text>
                  <Text className="text-white/50 text-xs mt-0.5">Connect WhatsApp Business API to start receiving conversations</Text>
                </View>
              </View>
            )}

            {/* ── Quick Stats ────────────────────────────────────────────── */}
            <View className="flex-row gap-2.5">
              <QuickStat label="Open" value={openCount} color="#25D366" />
              <QuickStat label="Pending" value={pendingCount} color="#f97316" />
              <QuickStat label="Resolved" value={resolvedCount} color="#3b82f6" />
              <QuickStat label="Contacts" value={contactsTotal} color="#a855f7" />
            </View>

            {/* ── Quick Actions ──────────────────────────────────────────── */}
            <Card>
              <View className="flex-row justify-around">
                <QuickAction
                  label="Inbox"
                  icon="chatbubbles"
                  color="#25D366"
                  onPress={() => router.push('/(app)/inbox')}
                />
                <QuickAction
                  label="Campaigns"
                  icon="megaphone"
                  color="#a855f7"
                  onPress={() => router.push('/(app)/campaigns')}
                />
                <QuickAction
                  label="Contacts"
                  icon="people"
                  color="#3b82f6"
                  onPress={() => router.push('/(app)/contacts')}
                />
                <QuickAction
                  label="Settings"
                  icon="settings"
                  color="#6b7280"
                  onPress={() => router.push('/(app)/settings')}
                />
              </View>
            </Card>

            {/* ── Conversation Activity ──────────────────────────────────── */}
            <Card>
              <SectionHeader icon="trending-up-outline" title="Conversation Activity" />
              {/* Date preset filter */}
              <View className="flex-row bg-white/5 rounded-xl p-1 gap-0.5 mb-4">
                {PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => applyPreset(p.key)}
                    className={`flex-1 py-1.5 rounded-lg items-center ${
                      preset === p.key ? 'bg-green' : ''
                    }`}
                    activeOpacity={0.75}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        preset === p.key ? 'text-white' : 'text-white/40'
                      }`}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {loadingStats ? (
                <ActivityIndicator color="#25D366" style={{ paddingVertical: 16 }} />
              ) : (
                <View className="flex-row gap-3">
                  <View className="flex-1 bg-green/10 border border-green/20 rounded-xl p-4 items-center">
                    <Ionicons name="trending-up" size={18} color="#25D366" />
                    <Text className="text-white font-bold text-2xl mt-1.5">
                      {(convStats?.opened ?? 0).toLocaleString()}
                    </Text>
                    <Text className="text-white/40 text-xs mt-1">Opened</Text>
                  </View>
                  <View className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 items-center">
                    <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />
                    <Text className="text-white font-bold text-2xl mt-1.5">
                      {(convStats?.closed ?? 0).toLocaleString()}
                    </Text>
                    <Text className="text-white/40 text-xs mt-1">Resolved</Text>
                  </View>
                </View>
              )}
            </Card>

            {/* ── WhatsApp Status ────────────────────────────────────────── */}
            {loadingWa ? null : waStatus ? (
              <Card>
                <SectionHeader
                  icon={waStatus.isConnected ? 'wifi-outline' : 'wifi-outline'}
                  title="WhatsApp Business API"
                />
                <View className="gap-2">
                  {[
                    {
                      label: 'Connection',
                      value: waStatus.isConnected ? 'Connected' : 'Disconnected',
                      dotColor: waStatus.isConnected ? '#22c55e' : '#ef4444',
                      valueColor: waStatus.isConnected ? '#22c55e' : '#ef4444',
                    },
                    {
                      label: 'Quality Rating',
                      value: waStatus.qualityRating || '—',
                      dotColor: waStatus.qualityRating === 'GREEN' ? '#22c55e' : waStatus.qualityRating === 'YELLOW' ? '#eab308' : '#ef4444',
                      valueColor: waStatus.qualityRating === 'GREEN' ? '#22c55e' : waStatus.qualityRating === 'YELLOW' ? '#eab308' : 'rgba(255,255,255,0.7)',
                    },
                    {
                      label: 'Verification',
                      value: waStatus.verificationStatus || '—',
                      dotColor: waStatus.verificationStatus === 'VERIFIED' ? '#22c55e' : '#eab308',
                      valueColor: waStatus.verificationStatus === 'VERIFIED' ? '#22c55e' : 'rgba(255,255,255,0.7)',
                    },
                    {
                      label: 'Messaging Limit',
                      value: waStatus.messagingLimit || '—',
                      dotColor: '#25D366',
                      valueColor: 'rgba(255,255,255,0.8)',
                    },
                  ].map(({ label, value, dotColor, valueColor }) => (
                    <View
                      key={label}
                      className="flex-row items-center justify-between bg-white/5 rounded-xl px-3 py-2.5"
                    >
                      <View className="flex-row items-center gap-2">
                        <StatusDot color={dotColor} />
                        <Text className="text-white/60 text-xs font-medium">{label}</Text>
                      </View>
                      <Text className="text-xs font-semibold" style={{ color: valueColor }}>
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {/* ── Team Performance ───────────────────────────────────────── */}
            {!loadingTeam && (
              <Card>
                <View className="flex-row items-center justify-between mb-3">
                  <SectionHeader icon="people-outline" title="Team Performance" />
                  <Text className="text-white/30 text-xs">{resolvedToday} resolved today</Text>
                </View>
                {team.length === 0 ? (
                  <Text className="text-white/30 text-xs text-center py-4">No team members</Text>
                ) : (
                  <View className="gap-3">
                    {team.slice(0, 6).map((m) => (
                      <View key={m.id} className="flex-row items-center gap-3">
                        {/* Avatar */}
                        <View className="relative">
                          <View className="w-9 h-9 rounded-full bg-green/15 items-center justify-center border border-green/20">
                            <Text className="text-green text-xs font-bold">
                              {m.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                            </Text>
                          </View>
                          <View
                            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card"
                            style={{ backgroundColor: m.isOnline ? '#22c55e' : '#4b5563' }}
                          />
                        </View>
                        {/* Info */}
                        <View className="flex-1 min-w-0">
                          <Text className="text-white text-xs font-semibold" numberOfLines={1}>{m.name}</Text>
                          <Text className="text-white/40 text-[10px]">
                            {m.assignedConversations} assigned · {m.resolvedToday} resolved
                          </Text>
                        </View>
                        {/* Online badge */}
                        <View
                          className={`px-2 py-0.5 rounded-full ${m.isOnline ? 'bg-green/15' : 'bg-white/5'}`}
                        >
                          <Text className={`text-[10px] font-medium ${m.isOnline ? 'text-green' : 'text-white/25'}`}>
                            {m.isOnline ? 'Online' : 'Away'}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            )}

            {/* ── AI Performance ─────────────────────────────────────────── */}
            <Card>
              <SectionHeader icon="flash-outline" title="AI Performance" />
              <View className="flex-row justify-between">
                <View className="items-center flex-1">
                  <Text className="text-white/40 text-xs mb-1">Handled</Text>
                  <Text className="text-white font-bold text-xl">
                    {overview?.aiHandledCount ?? 0}
                  </Text>
                </View>
                <View className="w-px bg-white/5" />
                <View className="items-center flex-1">
                  <Text className="text-white/40 text-xs mb-1">Avg Confidence</Text>
                  <Text className="text-green font-bold text-xl">
                    {overview?.avgConfidence != null
                      ? `${Math.round(overview.avgConfidence * 100)}%`
                      : '—'}
                  </Text>
                </View>
                <View className="w-px bg-white/5" />
                <View className="items-center flex-1">
                  <Text className="text-white/40 text-xs mb-1">Escalated</Text>
                  <Text className="text-orange-400 font-bold text-xl">
                    {overview?.escalatedCount ?? 0}
                  </Text>
                </View>
              </View>
            </Card>

            {/* ── Business Info ──────────────────────────────────────────── */}
            {biz && (
              <Card className="mb-6">
                <SectionHeader icon="business-outline" title="Business Information" />
                <View className="gap-0">
                  {[
                    { label: 'Name', value: biz.name },
                    { label: 'Phone', value: biz.phone },
                    { label: 'Email', value: biz.email },
                    { label: 'Address', value: biz.address },
                    { label: 'Website', value: biz.website },
                  ]
                    .filter((r) => r.value)
                    .map(({ label, value }) => (
                      <View
                        key={label}
                        className="flex-row items-start justify-between py-2 border-b border-white/5 last:border-0"
                      >
                        <Text className="text-white/40 text-xs flex-shrink-0">{label}</Text>
                        <Text className="text-white/80 text-xs text-right flex-1 ml-4" numberOfLines={2}>
                          {value}
                        </Text>
                      </View>
                    ))}
                </View>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
