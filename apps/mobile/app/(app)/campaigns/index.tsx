import React, { useState, useCallback } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { CampaignStatus } from '@whatsapp-platform/shared-types';

const STATUS_COLORS: Record<string, string> = {
  [CampaignStatus.DRAFT]: '#64748b',
  [CampaignStatus.SCHEDULED]: '#3b82f6',
  [CampaignStatus.RUNNING]: '#25D366',
  [CampaignStatus.PAUSED]: '#f97316',
  [CampaignStatus.COMPLETED]: '#8b5cf6',
  [CampaignStatus.FAILED]: '#ef4444',
};

type FilterTab = 'ALL' | 'RUNNING' | 'SCHEDULED' | 'DRAFT' | 'COMPLETED';
const TABS: { key: FilterTab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'RUNNING', label: 'Running' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'DRAFT', label: 'Drafts' },
  { key: 'COMPLETED', label: 'Done' },
];

interface Campaign {
  id: string;
  name: string;
  status: string;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt?: string | null;
  recipientCount?: number;
}

export default function CampaignsScreen() {
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['campaigns', activeTab],
    queryFn: () =>
      apiClient.campaigns
        .list({ limit: 30, status: activeTab === 'ALL' ? undefined : activeTab })
        .then((r) => (r.data.data ?? r.data) as Campaign[]),
  });

  const handleTabPress = useCallback((tab: FilterTab) => setActiveTab(tab), []);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 pt-2 pb-0 border-b border-white/5">
        <Text className="text-white text-xl font-bold mb-3">Campaigns</Text>
        <View className="flex-row gap-1 pb-3">
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

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className="bg-surface-card rounded-2xl p-4 border border-white/5"
              onPress={() => router.push(`/(app)/campaigns/${item.id}`)}
              activeOpacity={0.8}
            >
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={1}>
                  {item.name}
                </Text>
                <View
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${STATUS_COLORS[item.status] ?? '#64748b'}20` }}
                >
                  <Text
                    className="text-xs font-bold"
                    style={{ color: STATUS_COLORS[item.status] ?? '#64748b' }}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>

              <View className="flex-row gap-4 mb-2">
                <Metric label="Sent" value={item.sentCount} />
                <Metric label="Delivered" value={item.deliveredCount} />
                <Metric label="Read" value={item.readCount} />
                <Metric label="Failed" value={item.failedCount} />
              </View>

              {item.scheduledAt && item.status === CampaignStatus.SCHEDULED && (
                <Text className="text-white/30 text-xs mt-1">
                  Scheduled: {new Date(item.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </Text>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center">
              <Text className="text-white/20 text-4xl mb-3">📢</Text>
              <Text className="text-white/30 text-base font-medium">No campaigns</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View>
      <Text className="text-white/40 text-xs">{label}</Text>
      <Text className="text-white font-bold text-base">{value.toLocaleString()}</Text>
    </View>
  );
}
