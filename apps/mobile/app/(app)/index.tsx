import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../src/lib/api';
import { useAuthStore } from '../../src/store/auth.store';

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);

  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => apiClient.dashboard.overview().then((r) => r.data),
  });

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View className="mb-6">
          <Text className="text-white/50 text-sm mb-1">{tenant?.name ?? 'Workspace'}</Text>
          <Text className="text-white text-2xl font-bold">
            Good morning, {user?.name?.split(' ')[0] ?? 'Agent'} 👋
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#25D366" size="large" />
        ) : (
          <View className="gap-4">
            {/* Stats row */}
            <View className="flex-row gap-3">
              <StatCard
                label="Open"
                value={overview?.openCount ?? 0}
                color="#25D366"
              />
              <StatCard
                label="Pending"
                value={overview?.pendingCount ?? 0}
                color="#f97316"
              />
              <StatCard
                label="Resolved"
                value={overview?.resolvedCount ?? 0}
                color="#3b82f6"
              />
            </View>

            {/* AI Stats */}
            <View className="bg-surface-card rounded-2xl p-4 border border-white/5">
              <Text className="text-white font-bold text-base mb-3">AI Performance</Text>
              <View className="flex-row justify-between">
                <View>
                  <Text className="text-white/50 text-xs mb-1">Handled</Text>
                  <Text className="text-white font-bold text-lg">
                    {overview?.aiHandledCount ?? 0}
                  </Text>
                </View>
                <View>
                  <Text className="text-white/50 text-xs mb-1">Avg Confidence</Text>
                  <Text className="text-green font-bold text-lg">
                    {overview?.avgConfidence != null
                      ? `${Math.round(overview.avgConfidence * 100)}%`
                      : '—'}
                  </Text>
                </View>
                <View>
                  <Text className="text-white/50 text-xs mb-1">Escalated</Text>
                  <Text className="text-orange-400 font-bold text-lg">
                    {overview?.escalatedCount ?? 0}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View
      className="flex-1 bg-surface-card rounded-2xl p-4 border border-white/5"
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <Text className="text-white/50 text-xs mb-1">{label}</Text>
      <Text className="text-white font-extrabold text-2xl">{value}</Text>
    </View>
  );
}
