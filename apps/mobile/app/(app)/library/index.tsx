import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal, Image,
  Alert, RefreshControl, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface MediaItem {
  id: string;
  type: string;
  mediaUrl?: string;
  fileUrl?: string;
  mediaType?: string;
  mimeType?: string;
  mediaCaption?: string;
  originalName?: string;
  mediaSize?: number;
  fileSize?: number;
  createdAt: string;
  direction?: string;
  contact?: { id: string; name: string | null; phone: string } | null;
  uploadedBy?: { id: string; name: string } | null;
  isAsset?: boolean;
}

const { width } = Dimensions.get('window');
const GRID_COLS = 3;
const CELL = (width - 32 - (GRID_COLS - 1) * 4) / GRID_COLS;

const TYPE_TABS = ['All', 'Images', 'Videos', 'Audio', 'Documents'] as const;

const MIME_ICON: Record<string, string> = {
  pdf: 'document-text',
  csv: 'grid',
  txt: 'document',
  audio: 'musical-notes',
  video: 'videocam',
  default: 'document-outline',
};

function mimeIcon(mimeType?: string): string {
  if (!mimeType) return MIME_ICON.default;
  if (mimeType.startsWith('audio/')) return MIME_ICON.audio;
  if (mimeType.startsWith('video/')) return MIME_ICON.video;
  if (mimeType.includes('pdf')) return MIME_ICON.pdf;
  if (mimeType.includes('csv')) return MIME_ICON.csv;
  return MIME_ICON.default;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isImage(item: MediaItem): boolean {
  const mime = item.mimeType ?? item.mediaType ?? '';
  const type = item.type ?? '';
  return mime.startsWith('image/') || type === 'IMAGE';
}

function isVideo(item: MediaItem): boolean {
  const mime = item.mimeType ?? item.mediaType ?? '';
  const type = item.type ?? '';
  return mime.startsWith('video/') || type === 'VIDEO';
}

function isAudio(item: MediaItem): boolean {
  const mime = item.mimeType ?? item.mediaType ?? '';
  const type = item.type ?? '';
  return mime.startsWith('audio/') || type === 'AUDIO';
}

function getUrl(item: MediaItem): string {
  return item.mediaUrl ?? item.fileUrl ?? '';
}

export default function LibraryScreen() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<(typeof TYPE_TABS)[number]>('All');
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [section, setSection] = useState<'agent' | 'customer'>('agent');

  const typeParam = activeTab === 'All' ? undefined
    : activeTab === 'Images' ? 'IMAGE'
    : activeTab === 'Videos' ? 'VIDEO'
    : activeTab === 'Audio' ? 'AUDIO'
    : 'DOCUMENT';

  const { data: agentAssets, isLoading: agentLoading, refetch: refetchAgent } = useQuery({
    queryKey: ['library', 'agent', typeParam],
    queryFn: () =>
      apiClient.media.list({ type: typeParam, limit: 100 }).then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: MediaItem[] }).data ?? [])) as MediaItem[],
  });

  const { data: customerFiles, isLoading: customerLoading, refetch: refetchCustomer } = useQuery({
    queryKey: ['library', 'customer', typeParam],
    queryFn: () =>
      apiClient.media.library({ type: typeParam, limit: 100 }).then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: MediaItem[] }).data ?? [])) as MediaItem[],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.media.deleteAsset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] });
      setPreview(null);
    },
    onError: () => Alert.alert('Error', 'Failed to delete file.'),
  });

  const handleDelete = (item: MediaItem) => {
    Alert.alert('Delete File', `Delete "${item.originalName ?? item.mediaCaption ?? 'this file'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(item.id) },
    ]);
  };

  const items = section === 'agent' ? (agentAssets ?? []) : (customerFiles ?? []);
  const isLoading = section === 'agent' ? agentLoading : customerLoading;
  const refetch = section === 'agent' ? refetchAgent : refetchCustomer;

  const renderGridItem = ({ item }: { item: MediaItem }) => {
    const url = getUrl(item);
    if (isImage(item) || isVideo(item)) {
      return (
        <TouchableOpacity
          style={{ width: CELL, height: CELL, margin: 2 }}
          onPress={() => setPreview(item)}
          activeOpacity={0.8}
        >
          {url ? (
            <Image source={{ uri: url }} style={{ width: CELL, height: CELL, borderRadius: 8 }} resizeMode="cover" />
          ) : (
            <View style={{ width: CELL, height: CELL, borderRadius: 8, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={isVideo(item) ? 'videocam' : 'image-outline'} size={24} color="rgba(255,255,255,0.2)" />
            </View>
          )}
          {isVideo(item) && (
            <View className="absolute bottom-1.5 left-1.5">
              <Ionicons name="play-circle" size={18} color="rgba(255,255,255,0.8)" />
            </View>
          )}
          {section === 'agent' && (
            <TouchableOpacity
              className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5"
              onPress={() => handleDelete(item)}
            >
              <Ionicons name="close" size={12} color="#fff" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    }

    // List row for audio/documents
    return (
      <TouchableOpacity
        className="flex-row items-center px-4 py-3 border-b border-white/5"
        onPress={() => setPreview(item)}
        activeOpacity={0.7}
      >
        <View className="w-10 h-10 rounded-xl bg-surface-card items-center justify-center mr-3">
          <Ionicons name={mimeIcon(item.mimeType ?? item.mediaType) as any} size={20} color="#25D366" />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-white text-sm font-medium" numberOfLines={1}>
            {item.originalName ?? item.mediaCaption ?? 'File'}
          </Text>
          <Text className="text-white/30 text-xs">{formatBytes(item.mediaSize ?? item.fileSize)}</Text>
        </View>
        {section === 'agent' && (
          <TouchableOpacity onPress={() => handleDelete(item)} className="p-1">
            <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.3)" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const showGrid = activeTab === 'All' || activeTab === 'Images' || activeTab === 'Videos';

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">Media Library</Text>
        <Text className="text-white/30 text-sm">{items.length} files</Text>
      </View>

      {/* Type tabs */}
      <View className="flex-row px-4 py-2 gap-2">
        {TYPE_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`rounded-full px-3 py-1 ${activeTab === tab ? 'bg-green' : 'bg-surface-card'}`}
          >
            <Text className={`text-xs font-semibold ${activeTab === tab ? 'text-white' : 'text-white/40'}`}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Section toggle */}
      <View className="flex-row mx-4 bg-surface-card rounded-xl p-1 mb-2">
        {(['agent', 'customer'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSection(s)}
            className={`flex-1 py-2 rounded-lg items-center ${section === s ? 'bg-green' : ''}`}
          >
            <Text className={`text-sm font-semibold ${section === s ? 'text-white' : 'text-white/40'}`}>
              {s === 'agent' ? 'Team Library' : 'Customer Files'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#25D366" />
        </View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Ionicons name="images-outline" size={48} color="rgba(255,255,255,0.1)" />
          <Text className="text-white/30 text-sm mt-3">No files found</Text>
        </View>
      ) : showGrid ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={GRID_COLS}
          renderItem={renderGridItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25D366" />}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderGridItem}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25D366" />}
        />
      )}

      {/* Preview modal */}
      <Modal visible={!!preview} animationType="fade" transparent>
        <View className="flex-1 bg-black/95 items-center justify-center" style={{ padding: 20 }}>
          <TouchableOpacity
            className="absolute top-14 right-5 z-10"
            onPress={() => setPreview(null)}
          >
            <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          {preview && isImage(preview) && getUrl(preview) ? (
            <Image
              source={{ uri: getUrl(preview) }}
              style={{ width: width - 40, height: width - 40, borderRadius: 12 }}
              resizeMode="contain"
            />
          ) : (
            <View className="items-center">
              <Ionicons name={mimeIcon(preview?.mimeType ?? preview?.mediaType) as any} size={64} color="#25D366" />
              <Text className="text-white font-semibold text-base mt-4 text-center">
                {preview?.originalName ?? preview?.mediaCaption ?? 'File'}
              </Text>
              <Text className="text-white/40 text-sm mt-1">
                {formatBytes(preview?.mediaSize ?? preview?.fileSize)}
              </Text>
            </View>
          )}

          {preview?.mediaCaption && (
            <Text className="text-white/60 text-sm mt-4 text-center">{preview.mediaCaption}</Text>
          )}
          {preview?.contact && (
            <Text className="text-white/30 text-xs mt-2">
              From: {preview.contact.name ?? preview.contact.phone}
            </Text>
          )}

          {section === 'agent' && preview && (
            <TouchableOpacity
              className="mt-6 bg-red-500/20 rounded-xl px-6 py-3"
              onPress={() => handleDelete(preview)}
            >
              <Text className="text-red-400 font-semibold">Delete File</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
