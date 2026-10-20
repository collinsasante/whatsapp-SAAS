import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';
import { useAppTheme } from '../../../src/theme/useAppTheme';

interface ChatbotFlow {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  keywords: string[];
  isActive: boolean;
  priority: number;
  executionCount: number;
  createdAt: string;
  nodes?: unknown;
}

const TRIGGERS = [
  { value: 'FIRST_MESSAGE', label: 'First Message', icon: 'chatbubble-ellipses' as const },
  { value: 'KEYWORD', label: 'Keyword Match', icon: 'key' as const },
  { value: 'BUTTON_REPLY', label: 'Button Reply', icon: 'radio-button-on' as const },
  { value: 'OPT_IN', label: 'Opt In', icon: 'checkmark-circle' as const },
  { value: 'FALLBACK', label: 'Fallback', icon: 'git-branch' as const },
];

const TRIGGER_COLOR: Record<string, string> = {
  FIRST_MESSAGE: '#3b82f6',
  KEYWORD: '#25D366',
  BUTTON_REPLY: '#a855f7',
  OPT_IN: '#10b981',
  FALLBACK: '#f97316',
};

function triggerLabel(t: string): string {
  return TRIGGERS.find((x) => x.value === t)?.label ?? t;
}

interface FlowForm {
  name: string;
  description: string;
  trigger: string;
  keywords: string;
}

const EMPTY_FORM: FlowForm = {
  name: '',
  description: '',
  trigger: 'FIRST_MESSAGE',
  keywords: '',
};

export default function ChatbotScreen() {
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FlowForm>(EMPTY_FORM);

  const { data: flows, isLoading, refetch } = useQuery({
    queryKey: ['chatbot-flows'],
    queryFn: () => apiClient.chatbotFlows.list().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: ChatbotFlow[] }).data ?? [])) as ChatbotFlow[],
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.chatbotFlows.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chatbot-flows'] });
      setShowModal(false);
      setForm(EMPTY_FORM);
    },
    onError: () => Alert.alert('Error', 'Failed to create flow.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.chatbotFlows.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chatbot-flows'] });
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    },
    onError: () => Alert.alert('Error', 'Failed to update flow.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.chatbotFlows.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbot-flows'] }),
    onError: () => Alert.alert('Error', 'Failed to delete flow.'),
  });

  const handleToggle = (flow: ChatbotFlow) => {
    updateMutation.mutate({ id: flow.id, data: { isActive: !flow.isActive } });
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert('Required', 'Please enter a flow name.');
      return;
    }
    const keywords = form.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description || null,
      trigger: form.trigger,
      isActive: true,
      nodes: { nodes: [], edges: [] },
    };
    if (form.trigger === 'KEYWORD') payload.keywords = keywords;
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openEdit = (flow: ChatbotFlow) => {
    setEditingId(flow.id);
    setForm({
      name: flow.name,
      description: flow.description ?? '',
      trigger: flow.trigger,
      keywords: (flow.keywords ?? []).join(', '),
    });
    setShowModal(true);
  };

  const activeCount = (flows ?? []).filter((f) => f.isActive).length;
  const totalRuns = (flows ?? []).reduce((sum, f) => sum + (f.executionCount ?? 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-light-border dark:border-white/5 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#25D366" />
          </TouchableOpacity>
          <Text className="text-light-text-primary dark:text-white text-xl font-bold">Chatbot Flows</Text>
        </View>
        <TouchableOpacity
          className="bg-green rounded-xl px-4 py-2 flex-row items-center gap-1.5"
          onPress={() => { setEditingId(null); setForm(EMPTY_FORM); setShowModal(true); }}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-white text-sm font-semibold">New Flow</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View className="flex-row px-4 py-3 gap-2">
        {[
          { label: 'Total', value: flows?.length ?? 0, color: '#fff' },
          { label: 'Active', value: activeCount, color: '#25D366' },
          { label: 'Total Runs', value: totalRuns, color: '#3b82f6' },
        ].map((s) => (
          <View key={s.label} className="flex-1 bg-light-card dark:bg-surface-card rounded-xl p-3 items-center">
            <Text className="text-lg font-bold" style={{ color: s.color }}>{s.value}</Text>
            <Text className="text-light-text-muted dark:text-white/40 text-[10px] font-medium mt-0.5">{s.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25D366" />}
      >
        {isLoading ? (
          <ActivityIndicator color="#25D366" style={{ marginTop: 40 }} />
        ) : (flows ?? []).length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="git-network-outline" size={48} color={colors.border} />
            <Text className="text-light-text-disabled dark:text-white/30 text-sm mt-3">No chatbot flows yet</Text>
            <Text className="text-light-text-disabled dark:text-white/20 text-xs mt-1">Create flows to automate customer conversations</Text>
          </View>
        ) : (
          (flows ?? []).map((flow) => {
            const trigColor = TRIGGER_COLOR[flow.trigger] ?? '#fff';
            const trigDef = TRIGGERS.find((t) => t.value === flow.trigger);
            return (
              <View key={flow.id} className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4 mb-3">
                <View className="flex-row items-start gap-3">
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center mt-0.5"
                    style={{ backgroundColor: trigColor + '20' }}
                  >
                    <Ionicons name={trigDef?.icon ?? 'git-branch-outline'} size={16} color={trigColor} />
                  </View>
                  <View className="flex-1 min-w-0">
                    <View className="flex-row items-center gap-2 mb-1">
                      <Text className="text-light-text-primary dark:text-white font-semibold text-sm flex-1" numberOfLines={1}>{flow.name}</Text>
                      <Switch
                        value={flow.isActive}
                        onValueChange={() => handleToggle(flow)}
                        trackColor={{ false: colors.border, true: '#25D366' }}
                        thumbColor="#fff"
                        style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                      />
                    </View>

                    {flow.description && (
                      <Text className="text-light-text-muted dark:text-white/40 text-xs mb-2" numberOfLines={2}>{flow.description}</Text>
                    )}

                    <View className="flex-row items-center gap-2 flex-wrap">
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: trigColor + '20' }}>
                        <Text className="text-[10px] font-semibold" style={{ color: trigColor }}>
                          {triggerLabel(flow.trigger)}
                        </Text>
                      </View>
                      {flow.keywords?.slice(0, 3).map((kw) => (
                        <View key={kw} className="bg-light-background dark:bg-surface rounded-full px-2 py-0.5">
                          <Text className="text-light-text-disabled dark:text-white/30 text-[10px]">{kw}</Text>
                        </View>
                      ))}
                      <Text className="text-light-text-disabled dark:text-white/30 text-xs">{flow.executionCount ?? 0} runs</Text>
                    </View>
                  </View>
                </View>

                {/* Note: full flow builder is available on web app */}
                <View className="bg-light-background dark:bg-surface/60 rounded-xl p-3 mt-3 flex-row items-center gap-2">
                  <Ionicons name="desktop-outline" size={14} color={colors.textDisabled} />
                  <Text className="text-light-text-disabled dark:text-white/30 text-xs">Edit flow diagram on web app</Text>
                </View>

                <View className="flex-row gap-2 mt-3 pt-3 border-t border-light-border dark:border-white/5">
                  <TouchableOpacity
                    className="flex-1 bg-light-background dark:bg-surface rounded-xl py-2 items-center"
                    onPress={() => openEdit(flow)}
                  >
                    <Text className="text-light-text-muted dark:text-white/50 text-xs font-semibold">Edit Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-red-500/10 rounded-xl py-2 items-center"
                    onPress={() =>
                      Alert.alert('Delete Flow', `Delete "${flow.name}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(flow.id) },
                      ])
                    }
                  >
                    <Text className="text-red-400 text-xs font-semibold">Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Create/Edit modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-light-background dark:bg-surface rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-light-text-primary dark:text-white text-lg font-bold">
                {editingId ? 'Edit Flow' : 'New Chatbot Flow'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="mb-4">
                <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Flow Name</Text>
                <TextInput
                  className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                  placeholder="e.g. Welcome Flow"
                  placeholderTextColor={colors.textDisabled}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                />
              </View>

              <View className="mb-4">
                <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Description (optional)</Text>
                <TextInput
                  className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                  placeholder="What does this flow do?"
                  placeholderTextColor={colors.textDisabled}
                  value={form.description}
                  onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
                  multiline
                  numberOfLines={2}
                />
              </View>

              <View className="mb-4">
                <Text className="text-light-text-muted dark:text-white/50 text-xs mb-2">Trigger</Text>
                <View className="flex-row flex-wrap gap-2">
                  {TRIGGERS.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      onPress={() => setForm((f) => ({ ...f, trigger: t.value }))}
                      className={`rounded-full px-3 py-1.5 flex-row items-center gap-1.5 ${form.trigger === t.value ? 'bg-green' : 'bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10'}`}
                    >
                      <Ionicons name={t.icon} size={12} color={form.trigger === t.value ? '#fff' : colors.textMuted} />
                      <Text className={`text-xs font-semibold ${form.trigger === t.value ? 'text-white' : 'text-light-text-muted dark:text-white/50'}`}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {form.trigger === 'KEYWORD' && (
                <View className="mb-4">
                  <Text className="text-light-text-muted dark:text-white/50 text-xs mb-1.5">Keywords (comma separated)</Text>
                  <TextInput
                    className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/10 rounded-xl px-4 py-3 text-light-text-primary dark:text-white"
                    placeholder="hi, hello, start, hey"
                    placeholderTextColor={colors.textDisabled}
                    value={form.keywords}
                    onChangeText={(v) => setForm((f) => ({ ...f, keywords: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}

              <View className="bg-green/10 rounded-xl p-3 mb-4 flex-row gap-2">
                <Ionicons name="information-circle-outline" size={16} color="#25D366" />
                <Text className="text-green/80 text-xs flex-1">
                  Use the web app to build the full visual flow with nodes and conditions.
                </Text>
              </View>

              <TouchableOpacity
                className="bg-green rounded-2xl py-4 items-center mb-2"
                onPress={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Save Flow</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
