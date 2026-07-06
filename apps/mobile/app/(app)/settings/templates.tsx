import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { TemplateStatus, TemplateCategory } from '@whatsapp-platform/shared-types';

const STATUS_COLORS: Record<string, string> = {
  [TemplateStatus.APPROVED]: '#25D366',
  [TemplateStatus.PENDING]: '#f97316',
  [TemplateStatus.REJECTED]: '#ef4444',
  [TemplateStatus.PAUSED]: '#64748b',
};

const CATEGORY_COLORS: Record<string, string> = {
  [TemplateCategory.MARKETING]: '#8b5cf6',
  [TemplateCategory.UTILITY]: '#3b82f6',
  [TemplateCategory.AUTHENTICATION]: '#f59e0b',
};

interface Template {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  body: string;
  header?: string | null;
  footer?: string | null;
}

export default function TemplatesScreen() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['templates'],
    queryFn: () =>
      apiClient.templates.list({ limit: 100 }).then((r) => (r.data.data ?? r.data) as Template[]),
  });

  const filtered = (data ?? []).filter(
    (t) =>
      !search ||
      (t.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (t.body ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <View className="flex-row items-center mb-3">
          <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#25D366" />
          </TouchableOpacity>
          <Text className="text-white font-semibold text-base flex-1">Templates</Text>
        </View>
        <TextInput
          className="bg-surface-card border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm"
          placeholder="Search templates..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />
          }
          renderItem={({ item }) => <TemplateCard template={item} />}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center">
              <Ionicons name="document-text-outline" size={48} color="rgba(255,255,255,0.15)" style={{ marginBottom: 12 }} />
              <Text className="text-white/30 text-base font-medium">
                {search ? 'No templates match' : 'No templates yet'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const statusColor = STATUS_COLORS[template.status] ?? '#64748b';
  const categoryColor = CATEGORY_COLORS[template.category] ?? '#64748b';
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      className="bg-surface-card rounded-2xl border border-white/5 p-4"
      onPress={() => setExpanded((v) => !v)}
      activeOpacity={0.8}
    >
      <View className="flex-row items-start justify-between mb-2">
        <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={1}>
          {template.name}
        </Text>
        <View
          className="px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${statusColor}20` }}
        >
          <Text className="text-[10px] font-bold" style={{ color: statusColor }}>
            {template.status}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2 mb-3">
        <View
          className="px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${categoryColor}18` }}
        >
          <Text className="text-[10px] font-semibold" style={{ color: categoryColor }}>
            {template.category}
          </Text>
        </View>
        <View className="px-2 py-0.5 bg-white/5 rounded-full">
          <Text className="text-white/40 text-[10px]">{(template.language ?? '').toUpperCase()}</Text>
        </View>
      </View>

      {template.header && (
        <Text className="text-white/50 text-xs font-semibold mb-1">{template.header}</Text>
      )}
      <Text
        className="text-white/70 text-xs leading-4"
        numberOfLines={expanded ? undefined : 2}
      >
        {template.body}
      </Text>
      {template.footer && expanded && (
        <Text className="text-white/30 text-xs mt-1 italic">{template.footer}</Text>
      )}
      {!expanded && (template.body?.length ?? 0) > 80 && (
        <Text className="text-green text-xs mt-1">tap to expand</Text>
      )}
    </TouchableOpacity>
  );
}
