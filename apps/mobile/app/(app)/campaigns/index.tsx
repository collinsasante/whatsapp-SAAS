import React from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
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

export default function CampaignsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () =>
      apiClient.campaigns.list({ limit: 20 }).then((r) => r.data.data ?? r.data),
  });

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">Campaigns</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              className="bg-surface-card rounded-2xl p-4 border border-white/5"
              activeOpacity={0.8}
            >
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={1}>
                  {item.name}
                </Text>
                <View
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${STATUS_COLORS[item.status] ?? '#64748b'}20` }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: STATUS_COLORS[item.status] ?? '#64748b' }}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-4">
                <Metric label="Sent" value={item.sentCount} />
                <Metric label="Delivered" value={item.deliveredCount} />
                <Metric label="Read" value={item.readCount} />
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center pt-20">
              <Text className="text-white/30">No campaigns yet</Text>
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
      <Text className="text-white font-bold text-base">{value}</Text>
    </View>
  );
}
