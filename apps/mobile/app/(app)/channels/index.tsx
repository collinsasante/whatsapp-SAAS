import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useAppTheme } from '../../../src/theme/useAppTheme';

interface Channel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  phoneNumber?: string;
}

const CHANNEL_DEFS = [
  {
    id: 'whatsapp-api',
    name: 'WhatsApp Business',
    icon: 'logo-whatsapp' as const,
    color: '#25D366',
    badge: 'Popular',
    description: 'Send campaigns, automate support, and close deals via Meta Cloud API.',
    connectType: 'api' as const,
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    icon: 'logo-facebook' as const,
    color: '#1877F2',
    badge: 'Coming Soon',
    description: 'Connect your Page now to reserve it. Inbox messaging is coming soon.',
    connectType: 'oauth' as const,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: 'logo-instagram' as const,
    color: '#E1306C',
    badge: 'Coming Soon',
    description: 'Connect your account now to reserve it. DM management is coming soon.',
    connectType: 'oauth' as const,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: 'musical-notes' as const,
    color: '#010101',
    badge: 'Beta',
    description: "Connect to verify your account. Business Messaging requires TikTok's own approval, not yet complete.",
    connectType: 'oauth' as const,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: 'paper-plane' as const,
    color: '#2CA5E0',
    badge: 'Coming Soon',
    description: "Connect a bot to verify it's live now. Full messaging is coming soon.",
    connectType: 'api' as const,
  },
];

export default function ChannelsScreen() {
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectTarget, setConnectTarget] = useState<(typeof CHANNEL_DEFS)[0] | null>(null);
  const [form, setForm] = useState({ name: '', phoneNumberId: '', wabaId: '', accessToken: '', botToken: '' });

  const { data: channels, isLoading, refetch } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient.channels.list().then((r) => (r.data as Channel[] | { data: Channel[] })),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: Channel[] }).data ?? [])),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiClient.channels.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
    onError: () => Alert.alert('Error', 'Failed to toggle channel.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.channels.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
    onError: () => Alert.alert('Error', 'Failed to remove channel.'),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.channels.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      setShowConnectModal(false);
      setForm({ name: '', phoneNumberId: '', wabaId: '', accessToken: '', botToken: '' });
    },
    onError: () => Alert.alert('Error', 'Failed to connect channel. Check your credentials.'),
  });

  const telegramMutation = useMutation({
    mutationFn: (botToken: string) => apiClient.channels.connectTelegram(botToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      setShowConnectModal(false);
      setForm({ name: '', phoneNumberId: '', wabaId: '', accessToken: '', botToken: '' });
    },
    onError: () => Alert.alert('Error', 'Invalid bot token, or Telegram could not verify this bot.'),
  });

  const handleConnect = () => {
    if (!connectTarget) return;
    if (connectTarget.id === 'whatsapp-api') {
      if (!form.name.trim()) {
        Alert.alert('Required', 'Please enter a channel name.');
        return;
      }
      if (!form.phoneNumberId || !form.wabaId || !form.accessToken) {
        Alert.alert('Required', 'All WhatsApp API fields are required.');
        return;
      }
      createMutation.mutate({
        name: form.name,
        type: 'WHATSAPP',
        phoneNumberId: form.phoneNumberId,
        wabaId: form.wabaId,
        accessToken: form.accessToken,
      });
    } else if (connectTarget.id === 'telegram') {
      if (!form.botToken) {
        Alert.alert('Required', 'Bot token is required.');
        return;
      }
      // Routes to the dedicated /channels/telegram/connect endpoint, which
      // validates the token against Telegram's own getMe API and derives the
      // channel name from the bot itself -- the generic /channels endpoint
      // doesn't accept a botToken field at all and would always 400.
      telegramMutation.mutate(form.botToken);
    } else {
      Alert.alert('Coming Soon', 'OAuth-based channels must be connected from the web app.');
    }
  };

  const handleDeleteConfirm = (id: string, name: string) => {
    Alert.alert('Remove Channel', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const connectedIds = new Set((channels ?? []).map((c) => c.type?.toLowerCase()));

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-light-border dark:border-white/5 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#25D366" />
          </TouchableOpacity>
          <Text className="text-light-text-primary dark:text-white text-xl font-bold">Channels</Text>
        </View>
        <View className="bg-green/20 rounded-full px-3 py-1">
          <Text className="text-green text-xs font-semibold">{channels?.length ?? 0} connected</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25D366" />}
      >
        {/* Connected channels */}
        {channels && channels.length > 0 && (
          <View className="mb-6">
            <Text className="text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Connected
            </Text>
            {channels.map((ch) => {
              const def = CHANNEL_DEFS.find((d) => d.id === ch.type?.toLowerCase() || d.name.toLowerCase().includes(ch.type?.toLowerCase() ?? ''));
              return (
                <View key={ch.id} className="bg-light-card dark:bg-surface-card rounded-2xl p-4 mb-3 border border-light-border dark:border-white/5">
                  <View className="flex-row items-center gap-3">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center"
                      style={{ backgroundColor: (def?.color ?? '#25D366') + '20' }}
                    >
                      <Ionicons name={def?.icon ?? 'radio'} size={20} color={def?.color ?? '#25D366'} />
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-light-text-primary dark:text-white font-semibold" numberOfLines={1}>{ch.name}</Text>
                      {ch.phoneNumber && (
                        <Text className="text-light-text-muted dark:text-white/40 text-xs">{ch.phoneNumber}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => toggleMutation.mutate(ch.id)}
                      className={`rounded-full px-3 py-1 ${ch.isActive ? 'bg-green/20' : 'bg-light-elevated dark:bg-white/10'}`}
                    >
                      <Text className={`text-xs font-semibold ${ch.isActive ? 'text-green' : 'text-light-text-muted dark:text-white/40'}`}>
                        {ch.isActive ? 'Active' : 'Paused'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteConfirm(ch.id, ch.name)} className="p-1">
                      <Ionicons name="trash-outline" size={16} color={colors.textDisabled} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Available channels */}
        <Text className="text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
          Available Platforms
        </Text>
        {CHANNEL_DEFS.map((def) => {
          const isConnected = connectedIds.has(def.id.replace('-api', '').replace('-', ''));
          return (
            <View key={def.id} className="bg-light-card dark:bg-surface-card rounded-2xl p-4 mb-3 border border-light-border dark:border-white/5">
              <View className="flex-row items-start gap-3">
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mt-0.5"
                  style={{ backgroundColor: def.color + '20' }}
                >
                  <Ionicons name={def.icon} size={20} color={def.color} />
                </View>
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-light-text-primary dark:text-white font-semibold">{def.name}</Text>
                    {def.badge && (
                      <View className="bg-green/20 rounded-full px-2 py-0.5">
                        <Text className="text-green text-[10px] font-semibold">{def.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-light-text-muted dark:text-white/40 text-xs leading-relaxed">{def.description}</Text>
                </View>
              </View>
              <TouchableOpacity
                className={`mt-3 rounded-xl py-2.5 items-center ${isConnected ? 'bg-light-elevated dark:bg-white/5' : 'bg-green/90'}`}
                onPress={() => {
                  if (isConnected) return;
                  if (def.connectType === 'oauth') {
                    Alert.alert('Web Required', 'OAuth connection requires the web app. Visit the Channels page on verzchat.com.');
                    return;
                  }
                  setConnectTarget(def);
                  setShowConnectModal(true);
                }}
                disabled={isConnected}
              >
                <Text className={`text-sm font-semibold ${isConnected ? 'text-light-text-disabled dark:text-white/30' : 'text-white'}`}>
                  {isConnected ? 'Connected' : def.connectType === 'oauth' ? 'Connect via Web' : 'Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Connect modal */}
      <Modal visible={showConnectModal} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-light-background dark:bg-surface rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-light-text-primary dark:text-white text-lg font-bold">Connect {connectTarget?.name}</Text>
              <TouchableOpacity onPress={() => setShowConnectModal(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View className="gap-3">
              <View>
                <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Channel Name</Text>
                <TextInput
                  className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                  placeholder="e.g. Main WhatsApp"
                  placeholderTextColor={colors.textDisabled}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              {connectTarget?.id === 'whatsapp-api' && (
                <>
                  <View>
                    <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Phone Number ID</Text>
                    <TextInput
                      className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                      placeholder="From Meta Developer Console"
                      placeholderTextColor={colors.textDisabled}
                      value={form.phoneNumberId}
                      onChangeText={(v) => setForm((f) => ({ ...f, phoneNumberId: v }))}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                  </View>
                  <View>
                    <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">WhatsApp Business Account ID</Text>
                    <TextInput
                      className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                      placeholder="WABA ID"
                      placeholderTextColor={colors.textDisabled}
                      value={form.wabaId}
                      onChangeText={(v) => setForm((f) => ({ ...f, wabaId: v }))}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                  </View>
                  <View>
                    <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Access Token</Text>
                    <TextInput
                      className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                      placeholder="Meta permanent access token"
                      placeholderTextColor={colors.textDisabled}
                      value={form.accessToken}
                      onChangeText={(v) => setForm((f) => ({ ...f, accessToken: v }))}
                      autoCorrect={false}
                      autoCapitalize="none"
                      secureTextEntry
                    />
                  </View>
                </>
              )}

              {connectTarget?.id === 'telegram' && (
                <View>
                  <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Bot Token</Text>
                  <TextInput
                    className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                    placeholder="From @BotFather"
                    placeholderTextColor={colors.textDisabled}
                    value={form.botToken}
                    onChangeText={(v) => setForm((f) => ({ ...f, botToken: v }))}
                    autoCorrect={false}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                </View>
              )}
            </View>

            <TouchableOpacity
              className="bg-green rounded-2xl py-4 items-center mt-6"
              onPress={handleConnect}
              disabled={createMutation.isPending || telegramMutation.isPending}
            >
              {createMutation.isPending || telegramMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">Connect Channel</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
