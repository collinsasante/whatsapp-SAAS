import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Channel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  phoneNumber?: string;
}

type WhatsAppNumberStatus = 'CONNECTED' | 'NEEDS_ATTENTION' | 'DISCONNECTED';

interface WhatsAppNumber {
  id: string;
  label: string;
  phoneNumberId: string;
  wabaId: string;
  isDefault: boolean;
  isActive: boolean;
  status: WhatsAppNumberStatus;
  lastError: string | null;
}

const STATUS_STYLES: Record<WhatsAppNumberStatus, { dot: string; label: string; text: string }> = {
  CONNECTED: { dot: '#25D366', label: 'Connected', text: 'text-green' },
  NEEDS_ATTENTION: { dot: '#F59E0B', label: 'Needs attention', text: 'text-amber-400' },
  DISCONNECTED: { dot: 'rgba(255,255,255,0.3)', label: 'Disconnected', text: 'text-white/40' },
};

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

const OTHER_CHANNEL_DEFS = CHANNEL_DEFS.filter((d) => d.id !== 'whatsapp-api');

export default function ChannelsScreen() {
  const qc = useQueryClient();
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectTarget, setConnectTarget] = useState<(typeof CHANNEL_DEFS)[0] | null>(null);
  const [form, setForm] = useState({ name: '', phoneNumberId: '', wabaId: '', accessToken: '', botToken: '' });

  // WhatsApp number being added/edited/reconnected -- null means "add new"
  const [waModalNumber, setWaModalNumber] = useState<WhatsAppNumber | 'new' | null>(null);
  const [waForm, setWaForm] = useState({ label: '', phoneNumberId: '', wabaId: '', accessToken: '' });
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: channels, isLoading, refetch } = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient.channels.list().then((r) => (r.data as Channel[] | { data: Channel[] })),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: Channel[] }).data ?? [])),
  });

  const { data: waNumbers, refetch: refetchWa } = useQuery({
    queryKey: ['whatsapp-numbers'],
    queryFn: () => apiClient.whatsappNumbers.list().then((r) => r.data as WhatsAppNumber[]),
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

  // ── WhatsApp number mutations ────────────────────────────────────────────
  const waCreateMutation = useMutation({
    mutationFn: (data: { label: string; phoneNumberId: string; wabaId: string; accessToken: string }) =>
      apiClient.whatsappNumbers.create(data),
    onSuccess: () => { void refetchWa(); setWaModalNumber(null); },
    onError: () => Alert.alert('Error', 'Failed to connect this number. Check your credentials.'),
  });

  const waUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) => apiClient.whatsappNumbers.update(id, data),
    onSuccess: () => { void refetchWa(); setWaModalNumber(null); },
    onError: () => Alert.alert('Error', 'Failed to update this number.'),
  });

  const waReconnectMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) => apiClient.whatsappNumbers.reconnect(id, data),
    onSuccess: () => { void refetchWa(); setWaModalNumber(null); },
    onError: () => Alert.alert('Error', 'Failed to reconnect this number. Check your credentials.'),
  });

  const waSetDefaultMutation = useMutation({
    mutationFn: (id: string) => apiClient.whatsappNumbers.setDefault(id),
    onSuccess: () => void refetchWa(),
    onError: () => Alert.alert('Error', 'Failed to set default number.'),
  });

  const waDeleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.whatsappNumbers.delete(id),
    onSuccess: () => void refetchWa(),
    onError: () => Alert.alert('Error', 'Failed to disconnect this number.'),
  });

  const handleConnect = () => {
    if (!connectTarget) return;
    if (connectTarget.id === 'telegram') {
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

  // ── WhatsApp number handlers ─────────────────────────────────────────────
  const openAddWaNumber = () => {
    setWaForm({ label: '', phoneNumberId: '', wabaId: '', accessToken: '' });
    setWaModalNumber('new');
  };

  const openEditWaNumber = (num: WhatsAppNumber) => {
    setWaForm({ label: num.label, phoneNumberId: num.phoneNumberId, wabaId: num.wabaId, accessToken: '' });
    setWaModalNumber(num);
  };

  const handleSaveWaNumber = () => {
    if (!waForm.label.trim() || !waForm.phoneNumberId.trim() || !waForm.wabaId.trim()) {
      Alert.alert('Required', 'Label, Phone Number ID, and WABA ID are required.');
      return;
    }
    const isNew = waModalNumber === 'new';
    if (isNew && !waForm.accessToken.trim()) {
      Alert.alert('Required', 'Access token is required.');
      return;
    }
    if (isNew) {
      waCreateMutation.mutate({ label: waForm.label, phoneNumberId: waForm.phoneNumberId, wabaId: waForm.wabaId, accessToken: waForm.accessToken });
      return;
    }
    const num = waModalNumber as WhatsAppNumber;
    const data: Record<string, string> = { label: waForm.label, phoneNumberId: waForm.phoneNumberId, wabaId: waForm.wabaId };
    if (waForm.accessToken.trim()) data.accessToken = waForm.accessToken.trim();
    if (num.isActive) waUpdateMutation.mutate({ id: num.id, data });
    else waReconnectMutation.mutate({ id: num.id, data });
  };

  const handleTestConnection = async (num: WhatsAppNumber) => {
    setTestingId(num.id);
    try {
      const res = await apiClient.whatsappNumbers.testConnection(num.id);
      const data = res.data as { success: boolean; error?: string };
      if (data.success) Alert.alert('Connection healthy', `${num.label} is working correctly.`);
      else Alert.alert('Connection failed', data.error ?? 'This number could not be verified.');
      void refetchWa();
    } catch {
      Alert.alert('Error', 'Could not reach the server to test this connection.');
    } finally { setTestingId(null); }
  };

  const handleDisconnectWaNumber = (num: WhatsAppNumber) => {
    Alert.alert('Disconnect Number', `Disconnect "${num.label}"? Conversations and messages are preserved -- you can reconnect it later.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => waDeleteMutation.mutate(num.id) },
    ]);
  };

  const waSaving = waCreateMutation.isPending || waUpdateMutation.isPending || waReconnectMutation.isPending;
  const otherChannels = (channels ?? []).filter((c) => c.type?.toUpperCase() !== 'WHATSAPP');
  const connectedIds = new Set(otherChannels.map((c) => c.type?.toLowerCase()));

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">Channels</Text>
        <View className="bg-green/20 rounded-full px-3 py-1">
          <Text className="text-green text-xs font-semibold">
            {otherChannels.length + (waNumbers?.length ?? 0)} connected
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { void refetch(); void refetchWa(); }} tintColor="#25D366" />}
      >
        {/* WhatsApp -- the one fully-functional, multi-account channel */}
        <View className="mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider">WhatsApp Business</Text>
            <TouchableOpacity onPress={openAddWaNumber} className="flex-row items-center gap-1 bg-green/20 rounded-full px-2.5 py-1">
              <Ionicons name="add" size={13} color="#25D366" />
              <Text className="text-green text-xs font-semibold">{waNumbers && waNumbers.length > 0 ? 'Add number' : 'Connect'}</Text>
            </TouchableOpacity>
          </View>

          {waNumbers && waNumbers.length > 0 ? (
            waNumbers.map((num) => {
              const style = STATUS_STYLES[num.status];
              return (
                <View key={num.id} className="bg-surface-card rounded-2xl p-4 mb-3 border border-white/5">
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: '#25D36620' }}>
                      <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                    </View>
                    <View className="flex-1 min-w-0">
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-white font-semibold" numberOfLines={1}>{num.label}</Text>
                        {num.isDefault && (
                          <View className="bg-green/20 rounded-full px-1.5 py-0.5"><Text className="text-green text-[9px] font-bold">Default</Text></View>
                        )}
                      </View>
                      <View className="flex-row items-center gap-1 mt-0.5">
                        <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
                        <Text className={`text-xs ${style.text}`}>{style.label}</Text>
                      </View>
                      {num.status === 'NEEDS_ATTENTION' && num.lastError && (
                        <Text className="text-amber-400 text-[11px] mt-1" numberOfLines={2}>{num.lastError}</Text>
                      )}
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2 mt-3 pt-3 border-t border-white/5">
                    {num.isActive ? (
                      <>
                        <TouchableOpacity
                          onPress={() => { void handleTestConnection(num); }}
                          disabled={testingId === num.id}
                          className="flex-row items-center gap-1 bg-white/5 rounded-lg px-2.5 py-1.5"
                        >
                          {testingId === num.id ? <ActivityIndicator size="small" color="#25D366" /> : <Ionicons name="pulse-outline" size={13} color="rgba(255,255,255,0.6)" />}
                          <Text className="text-white/60 text-xs font-medium">Test</Text>
                        </TouchableOpacity>
                        {!num.isDefault && (
                          <TouchableOpacity onPress={() => waSetDefaultMutation.mutate(num.id)} className="bg-white/5 rounded-lg px-2.5 py-1.5">
                            <Text className="text-white/60 text-xs font-medium">Set default</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => openEditWaNumber(num)} className="bg-white/5 rounded-lg px-2.5 py-1.5">
                          <Ionicons name="create-outline" size={13} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDisconnectWaNumber(num)} className="bg-white/5 rounded-lg px-2.5 py-1.5 ml-auto">
                          <Ionicons name="unlink-outline" size={13} color="rgba(255,100,100,0.8)" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity onPress={() => openEditWaNumber(num)} className="flex-row items-center gap-1.5 bg-green/90 rounded-lg px-3 py-1.5 ml-auto">
                        <Ionicons name="refresh" size={13} color="#fff" />
                        <Text className="text-white text-xs font-semibold">Reconnect</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          ) : (
            <View className="bg-surface-card rounded-2xl p-4 border border-white/5">
              <Text className="text-white/40 text-xs leading-relaxed">
                Connect a WhatsApp number to start sending and receiving messages.
              </Text>
            </View>
          )}
        </View>

        {/* Other platforms */}
        <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
          Other Platforms
        </Text>
        {otherChannels.length > 0 && (
          <View className="mb-3">
            {otherChannels.map((ch) => {
              const def = OTHER_CHANNEL_DEFS.find((d) => d.id === ch.type?.toLowerCase() || d.name.toLowerCase().includes(ch.type?.toLowerCase() ?? ''));
              return (
                <View key={ch.id} className="bg-surface-card rounded-2xl p-4 mb-3 border border-white/5">
                  <View className="flex-row items-center gap-3">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center"
                      style={{ backgroundColor: (def?.color ?? '#888') + '20' }}
                    >
                      <Ionicons name={def?.icon ?? 'radio'} size={20} color={def?.color ?? '#888'} />
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-white font-semibold" numberOfLines={1}>{ch.name}</Text>
                      {ch.phoneNumber && (
                        <Text className="text-white/40 text-xs">{ch.phoneNumber}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => toggleMutation.mutate(ch.id)}
                      className={`rounded-full px-3 py-1 ${ch.isActive ? 'bg-green/20' : 'bg-white/10'}`}
                    >
                      <Text className={`text-xs font-semibold ${ch.isActive ? 'text-green' : 'text-white/40'}`}>
                        {ch.isActive ? 'Active' : 'Paused'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteConfirm(ch.id, ch.name)} className="p-1">
                      <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {OTHER_CHANNEL_DEFS.map((def) => {
          const isConnected = connectedIds.has(def.id.replace('-api', '').replace('-', ''));
          return (
            <View key={def.id} className="bg-surface-card rounded-2xl p-4 mb-3 border border-white/5">
              <View className="flex-row items-start gap-3">
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mt-0.5"
                  style={{ backgroundColor: def.color + '20' }}
                >
                  <Ionicons name={def.icon} size={20} color={def.color} />
                </View>
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-white font-semibold">{def.name}</Text>
                    {def.badge && (
                      <View className="bg-green/20 rounded-full px-2 py-0.5">
                        <Text className="text-green text-[10px] font-semibold">{def.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-white/40 text-xs leading-relaxed">{def.description}</Text>
                </View>
              </View>
              <TouchableOpacity
                className={`mt-3 rounded-xl py-2.5 items-center ${isConnected ? 'bg-white/5' : 'bg-green/90'}`}
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
                <Text className={`text-sm font-semibold ${isConnected ? 'text-white/30' : 'text-white'}`}>
                  {isConnected ? 'Connected' : def.connectType === 'oauth' ? 'Connect via Web' : 'Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Connect modal (Telegram only now -- WhatsApp has its own modal below) */}
      <Modal visible={showConnectModal} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-surface rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white text-lg font-bold">Connect {connectTarget?.name}</Text>
              <TouchableOpacity onPress={() => setShowConnectModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <View className="gap-3">
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Bot Token</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="From @BotFather"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={form.botToken}
                  onChangeText={(v) => setForm((f) => ({ ...f, botToken: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                  secureTextEntry
                />
              </View>
            </View>

            <TouchableOpacity
              className="bg-green rounded-2xl py-4 items-center mt-6"
              onPress={handleConnect}
              disabled={telegramMutation.isPending}
            >
              {telegramMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">Connect Channel</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* WhatsApp number add/edit/reconnect modal */}
      <Modal visible={waModalNumber !== null} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-surface rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white text-lg font-bold">
                {waModalNumber === 'new' ? 'Connect WhatsApp Number' : (waModalNumber as WhatsAppNumber | null)?.isActive ? 'Edit Number' : 'Reconnect Number'}
              </Text>
              <TouchableOpacity onPress={() => setWaModalNumber(null)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <View className="gap-3">
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Label</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="e.g. Sales, Support"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={waForm.label}
                  onChangeText={(v) => setWaForm((f) => ({ ...f, label: v }))}
                  autoCorrect={false}
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs mb-1.5">Phone Number ID</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="From Meta Developer Console"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={waForm.phoneNumberId}
                  onChangeText={(v) => setWaForm((f) => ({ ...f, phoneNumberId: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs mb-1.5">WhatsApp Business Account ID</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="WABA ID"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={waForm.wabaId}
                  onChangeText={(v) => setWaForm((f) => ({ ...f, wabaId: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <View>
                <Text className="text-white/50 text-xs mb-1.5">
                  Access Token{waModalNumber !== 'new' ? ' (leave blank to keep existing)' : ''}
                </Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="Meta permanent access token"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={waForm.accessToken}
                  onChangeText={(v) => setWaForm((f) => ({ ...f, accessToken: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                  secureTextEntry
                />
              </View>
            </View>

            <TouchableOpacity
              className="bg-green rounded-2xl py-4 items-center mt-6"
              onPress={handleSaveWaNumber}
              disabled={waSaving}
            >
              {waSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">
                  {waModalNumber === 'new' ? 'Connect' : (waModalNumber as WhatsAppNumber | null)?.isActive ? 'Save Changes' : 'Reconnect'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
