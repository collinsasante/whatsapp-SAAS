import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

interface Campaign {
  id: string;
  name: string;
  status: string;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  recipientCount?: number;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  template?: { name: string; body?: string } | null;
  message?: string | null;
}

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: campaign, isLoading, refetch } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => apiClient.campaigns.get(id).then((r) => r.data as Campaign),
    enabled: !!id,
    refetchInterval: (data) =>
      (data?.state.data as Campaign | undefined)?.status === CampaignStatus.RUNNING ? 10000 : false,
  });

  const handleAction = (action: 'launch' | 'pause' | 'resume') => {
    const labels: Record<string, string> = {
      launch: 'Launch Campaign',
      pause: 'Pause Campaign',
      resume: 'Resume Campaign',
    };
    Alert.alert(labels[action] ?? action, 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            if (action === 'launch') await apiClient.campaigns.launch(id);
            else if (action === 'pause') await apiClient.campaigns.pause(id);
            else await apiClient.campaigns.resume(id);
            await refetch();
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
          } catch {
            Alert.alert('Error', `Could not ${action} campaign.`);
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <ActivityIndicator color="#25D366" size="large" />
      </SafeAreaView>
    );
  }

  if (!campaign) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <Text className="text-white/40">Campaign not found</Text>
      </SafeAreaView>
    );
  }

  const statusColor = STATUS_COLORS[campaign.status] ?? '#64748b';
  const total = campaign.sentCount || 1;
  const deliveryRate = Math.round((campaign.deliveredCount / total) * 100);
  const readRate = Math.round((campaign.readCount / total) * 100);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text className="text-green text-base">←</Text>
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1" numberOfLines={1}>
          {campaign.name}
        </Text>
        <View
          className="px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${statusColor}20` }}
        >
          <Text className="text-xs font-bold" style={{ color: statusColor }}>
            {campaign.status}
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Action buttons */}
        {campaign.status === CampaignStatus.DRAFT && (
          <TouchableOpacity
            className="bg-green rounded-xl py-3.5 items-center"
            onPress={() => handleAction('launch')}
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold">Launch Campaign</Text>
          </TouchableOpacity>
        )}
        {campaign.status === CampaignStatus.RUNNING && (
          <TouchableOpacity
            className="bg-orange-500 rounded-xl py-3.5 items-center"
            onPress={() => handleAction('pause')}
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold">Pause Campaign</Text>
          </TouchableOpacity>
        )}
        {campaign.status === CampaignStatus.PAUSED && (
          <TouchableOpacity
            className="bg-blue-500 rounded-xl py-3.5 items-center"
            onPress={() => handleAction('resume')}
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold">Resume Campaign</Text>
          </TouchableOpacity>
        )}

        {/* Delivery stats */}
        <View className="bg-surface-card rounded-2xl border border-white/5 p-4">
          <Text className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
            Delivery Stats
          </Text>
          <View className="flex-row justify-between mb-4">
            <StatBox label="Sent" value={campaign.sentCount} color="#64748b" />
            <StatBox label="Delivered" value={campaign.deliveredCount} color="#25D366" />
            <StatBox label="Read" value={campaign.readCount} color="#3b82f6" />
            <StatBox label="Failed" value={campaign.failedCount} color="#ef4444" />
          </View>
          {campaign.sentCount > 0 && (
            <View className="gap-2">
              <ProgressBar label="Delivery rate" value={deliveryRate} color="#25D366" />
              <ProgressBar label="Read rate" value={readRate} color="#3b82f6" />
            </View>
          )}
        </View>

        {/* Details */}
        <View className="bg-surface-card rounded-2xl border border-white/5 overflow-hidden">
          {campaign.recipientCount != null && (
            <DetailRow label="Recipients" value={String(campaign.recipientCount)} />
          )}
          {campaign.scheduledAt && (
            <DetailRow
              label="Scheduled"
              value={new Date(campaign.scheduledAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            />
          )}
          {campaign.startedAt && (
            <DetailRow
              label="Started"
              value={new Date(campaign.startedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            />
          )}
          {campaign.completedAt && (
            <DetailRow
              label="Completed"
              value={new Date(campaign.completedAt).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            />
          )}
          {campaign.template && (
            <DetailRow label="Template" value={campaign.template.name} />
          )}
        </View>

        {/* Message preview */}
        {(campaign.message || campaign.template?.body) && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-4">
            <Text className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              Message
            </Text>
            <Text className="text-white/80 text-sm leading-5">
              {campaign.message ?? campaign.template?.body}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="items-center">
      <Text className="text-white font-extrabold text-xl" style={{ color }}>
        {value.toLocaleString()}
      </Text>
      <Text className="text-white/40 text-xs mt-0.5">{label}</Text>
    </View>
  );
}

function ProgressBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View>
      <View className="flex-row justify-between mb-1">
        <Text className="text-white/50 text-xs">{label}</Text>
        <Text className="text-white/70 text-xs font-semibold">{value}%</Text>
      </View>
      <View className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
        />
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center px-4 py-3.5 border-b border-white/5 last:border-0">
      <Text className="text-white/40 text-sm w-24">{label}</Text>
      <Text className="text-white text-sm flex-1">{value}</Text>
    </View>
  );
}
