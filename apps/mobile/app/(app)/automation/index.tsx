import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Condition {
  field: string;
  operator: string;
  value: string;
}

interface Action {
  type: string;
  payload: Record<string, string>;
}

interface AutomationRule {
  id: string;
  name: string;
  isActive: boolean;
  trigger: string;
  conditions: Condition[];
  actions: Action[];
  executionCount: number;
  priority: number;
  createdAt: string;
}

const TRIGGERS = [
  { value: 'KEYWORD', label: 'Keyword Match' },
  { value: 'FIRST_MESSAGE', label: 'First Message' },
  { value: 'CONVERSATION_CREATED', label: 'Conversation Created' },
  { value: 'CONVERSATION_RESOLVED', label: 'Conversation Resolved' },
  { value: 'LABEL_ADDED', label: 'Label Added' },
  { value: 'NO_REPLY_TIMEOUT', label: 'No Reply Timeout' },
  { value: 'CAMPAIGN_RESPONSE', label: 'Campaign Response' },
];

const CONDITION_FIELDS = ['message_content', 'contact_phone', 'contact_name', 'label'];
const CONDITION_OPERATORS = ['contains', 'equals', 'starts_with', 'ends_with'];
const ACTION_TYPES = [
  { value: 'SEND_MESSAGE', label: 'Send Message' },
  { value: 'ASSIGN_AGENT', label: 'Assign Agent' },
  { value: 'ADD_LABEL', label: 'Add Label' },
  { value: 'RESOLVE_CONVERSATION', label: 'Resolve Conversation' },
  { value: 'SEND_TEMPLATE', label: 'Send Template' },
  { value: 'WEBHOOK_CALL', label: 'Webhook Call' },
];

const TRIGGER_COLOR: Record<string, string> = {
  KEYWORD: '#25D366',
  FIRST_MESSAGE: '#3b82f6',
  CONVERSATION_CREATED: '#a855f7',
  CONVERSATION_RESOLVED: '#10b981',
  LABEL_ADDED: '#f97316',
  NO_REPLY_TIMEOUT: '#ef4444',
  CAMPAIGN_RESPONSE: '#06b6d4',
};

function triggerLabel(t: string): string {
  return TRIGGERS.find((x) => x.value === t)?.label ?? t;
}

function actionLabel(t: string): string {
  return ACTION_TYPES.find((x) => x.value === t)?.label ?? t;
}

interface RuleForm {
  name: string;
  trigger: string;
  priority: string;
  conditions: Condition[];
  actions: Action[];
}

const EMPTY_FORM: RuleForm = {
  name: '',
  trigger: 'KEYWORD',
  priority: '0',
  conditions: [],
  actions: [{ type: 'SEND_MESSAGE', payload: { message: '' } }],
};

export default function AutomationScreen() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);

  const { data: rules, isLoading, refetch } = useQuery({
    queryKey: ['automation'],
    queryFn: () => apiClient.automation.list().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: AutomationRule[] }).data ?? [])) as AutomationRule[],
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.automation.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation'] });
      setShowModal(false);
      setForm(EMPTY_FORM);
    },
    onError: () => Alert.alert('Error', 'Failed to create rule.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.automation.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation'] });
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    },
    onError: () => Alert.alert('Error', 'Failed to update rule.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.automation.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation'] }),
    onError: () => Alert.alert('Error', 'Failed to delete rule.'),
  });

  const handleToggle = (rule: AutomationRule) => {
    updateMutation.mutate({ id: rule.id, data: { isActive: !rule.isActive } });
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert('Required', 'Please enter a rule name.');
      return;
    }
    const payload = {
      name: form.name,
      trigger: form.trigger,
      priority: parseInt(form.priority) || 0,
      conditions: form.conditions,
      actions: form.actions,
      isActive: true,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openEdit = (rule: AutomationRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      trigger: rule.trigger,
      priority: String(rule.priority),
      conditions: rule.conditions ?? [],
      actions: rule.actions ?? [],
    });
    setShowModal(true);
  };

  const addCondition = () => {
    setForm((f) => ({
      ...f,
      conditions: [...f.conditions, { field: 'message_content', operator: 'contains', value: '' }],
    }));
  };

  const addAction = () => {
    setForm((f) => ({
      ...f,
      actions: [...f.actions, { type: 'SEND_MESSAGE', payload: { message: '' } }],
    }));
  };

  const activeCount = (rules ?? []).filter((r) => r.isActive).length;
  const totalRuns = (rules ?? []).reduce((sum, r) => sum + (r.executionCount ?? 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <Text className="text-white text-xl font-bold">Automation</Text>
        <TouchableOpacity
          className="bg-green rounded-xl px-4 py-2 flex-row items-center gap-1.5"
          onPress={() => { setEditingId(null); setForm(EMPTY_FORM); setShowModal(true); }}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-white text-sm font-semibold">New Rule</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View className="flex-row px-4 py-3 gap-2">
        {[
          { label: 'Total Rules', value: rules?.length ?? 0, color: '#fff' },
          { label: 'Active', value: activeCount, color: '#25D366' },
          { label: 'Total Runs', value: totalRuns, color: '#3b82f6' },
        ].map((s) => (
          <View key={s.label} className="flex-1 bg-surface-card rounded-xl p-3 items-center">
            <Text className="text-lg font-bold" style={{ color: s.color }}>{s.value}</Text>
            <Text className="text-white/40 text-[10px] font-medium mt-0.5">{s.label}</Text>
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
        ) : (rules ?? []).length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="flash-outline" size={48} color="rgba(255,255,255,0.1)" />
            <Text className="text-white/30 text-sm mt-3">No automation rules</Text>
            <Text className="text-white/20 text-xs mt-1">Create rules to automate responses and actions</Text>
          </View>
        ) : (
          (rules ?? []).map((rule) => {
            const trigColor = TRIGGER_COLOR[rule.trigger] ?? '#fff';
            return (
              <View key={rule.id} className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-3">
                <View className="flex-row items-start gap-3">
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center mt-0.5"
                    style={{ backgroundColor: trigColor + '20' }}
                  >
                    <Ionicons name="flash" size={16} color={trigColor} />
                  </View>
                  <View className="flex-1 min-w-0">
                    <View className="flex-row items-center gap-2 mb-1">
                      <Text className="text-white font-semibold text-sm flex-1" numberOfLines={1}>{rule.name}</Text>
                      <Switch
                        value={rule.isActive}
                        onValueChange={() => handleToggle(rule)}
                        trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#25D366' }}
                        thumbColor="#fff"
                        style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                      />
                    </View>

                    {/* Trigger badge */}
                    <View className="flex-row items-center gap-2 mb-2">
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: trigColor + '20' }}>
                        <Text className="text-[10px] font-semibold" style={{ color: trigColor }}>
                          {triggerLabel(rule.trigger)}
                        </Text>
                      </View>
                      <Text className="text-white/30 text-xs">{rule.executionCount ?? 0} runs</Text>
                    </View>

                    {/* Conditions */}
                    {rule.conditions?.length > 0 && (
                      <View className="flex-row flex-wrap gap-1 mb-1">
                        {rule.conditions.slice(0, 2).map((c, i) => (
                          <View key={i} className="bg-surface rounded-full px-2 py-0.5">
                            <Text className="text-white/30 text-[10px]">
                              {c.field} {c.operator} "{c.value}"
                            </Text>
                          </View>
                        ))}
                        {rule.conditions.length > 2 && (
                          <Text className="text-white/20 text-[10px]">+{rule.conditions.length - 2} more</Text>
                        )}
                      </View>
                    )}

                    {/* Actions */}
                    {rule.actions?.length > 0 && (
                      <View className="flex-row flex-wrap gap-1">
                        {rule.actions.slice(0, 2).map((a, i) => (
                          <View key={i} className="bg-purple-500/10 rounded-full px-2 py-0.5">
                            <Text className="text-purple-300 text-[10px]">{actionLabel(a.type)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                <View className="flex-row gap-2 mt-3 pt-3 border-t border-white/5">
                  <TouchableOpacity
                    className="flex-1 bg-surface rounded-xl py-2 items-center"
                    onPress={() => openEdit(rule)}
                  >
                    <Text className="text-white/50 text-xs font-semibold">Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-red-500/10 rounded-xl py-2 items-center"
                    onPress={() =>
                      Alert.alert('Delete Rule', `Delete "${rule.name}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(rule.id) },
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
          <View className="bg-surface rounded-t-3xl p-6" style={{ maxHeight: '90%' }}>
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white text-lg font-bold">
                {editingId ? 'Edit Rule' : 'New Automation Rule'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Name */}
              <View className="mb-4">
                <Text className="text-white/50 text-xs mb-1.5">Rule Name</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="e.g. Welcome new customers"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                />
              </View>

              {/* Trigger picker */}
              <View className="mb-4">
                <Text className="text-white/50 text-xs mb-2">Trigger</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {TRIGGERS.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      onPress={() => setForm((f) => ({ ...f, trigger: t.value }))}
                      className={`rounded-full px-3 py-1.5 ${form.trigger === t.value ? 'bg-green' : 'bg-surface-card border border-white/10'}`}
                    >
                      <Text className={`text-xs font-semibold ${form.trigger === t.value ? 'text-white' : 'text-white/50'}`}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Conditions */}
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-white/50 text-xs">Conditions (optional)</Text>
                  <TouchableOpacity onPress={addCondition}>
                    <Text className="text-green text-xs font-semibold">+ Add</Text>
                  </TouchableOpacity>
                </View>
                {form.conditions.map((c, i) => (
                  <View key={i} className="bg-surface-card rounded-xl p-3 mb-2">
                    <View className="flex-row gap-2 mb-2">
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {CONDITION_FIELDS.map((f) => (
                          <TouchableOpacity
                            key={f}
                            onPress={() => setForm((sf) => {
                              const conds = [...sf.conditions];
                              conds[i] = { ...conds[i]!, field: f };
                              return { ...sf, conditions: conds };
                            })}
                            className={`rounded-full px-2 py-1 ${c.field === f ? 'bg-green/20' : 'bg-surface border border-white/10'}`}
                          >
                            <Text className={`text-[10px] ${c.field === f ? 'text-green' : 'text-white/40'}`}>{f}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                    <View className="flex-row gap-2 mb-2">
                      {CONDITION_OPERATORS.map((op) => (
                        <TouchableOpacity
                          key={op}
                          onPress={() => setForm((sf) => {
                            const conds = [...sf.conditions];
                            conds[i] = { ...conds[i]!, operator: op };
                            return { ...sf, conditions: conds };
                          })}
                          className={`rounded-full px-2 py-0.5 ${c.operator === op ? 'bg-green/20' : 'bg-surface border border-white/10'}`}
                        >
                          <Text className={`text-[10px] ${c.operator === op ? 'text-green' : 'text-white/40'}`}>{op}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View className="flex-row items-center gap-2">
                      <TextInput
                        className="flex-1 bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                        placeholder="Value..."
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        value={c.value}
                        onChangeText={(v) => setForm((sf) => {
                          const conds = [...sf.conditions];
                          conds[i] = { ...conds[i]!, value: v };
                          return { ...sf, conditions: conds };
                        })}
                      />
                      <TouchableOpacity
                        onPress={() => setForm((sf) => ({
                          ...sf,
                          conditions: sf.conditions.filter((_, idx) => idx !== i),
                        }))}
                        className="p-1"
                      >
                        <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.3)" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>

              {/* Actions */}
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-white/50 text-xs">Actions</Text>
                  <TouchableOpacity onPress={addAction}>
                    <Text className="text-green text-xs font-semibold">+ Add</Text>
                  </TouchableOpacity>
                </View>
                {form.actions.map((a, i) => (
                  <View key={i} className="bg-surface-card rounded-xl p-3 mb-2">
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
                      {ACTION_TYPES.map((t) => (
                        <TouchableOpacity
                          key={t.value}
                          onPress={() => setForm((sf) => {
                            const acts = [...sf.actions];
                            acts[i] = { ...acts[i]!, type: t.value, payload: {} };
                            return { ...sf, actions: acts };
                          })}
                          className={`rounded-full px-2 py-1 ${a.type === t.value ? 'bg-purple-500/30' : 'bg-surface border border-white/10'}`}
                        >
                          <Text className={`text-[10px] ${a.type === t.value ? 'text-purple-300' : 'text-white/40'}`}>{t.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    {a.type === 'SEND_MESSAGE' && (
                      <TextInput
                        className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                        placeholder="Message to send..."
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        value={a.payload.message ?? ''}
                        onChangeText={(v) => setForm((sf) => {
                          const acts = [...sf.actions];
                          acts[i] = { ...acts[i]!, payload: { message: v } };
                          return { ...sf, actions: acts };
                        })}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                    )}
                    {(a.type === 'ADD_LABEL' || a.type === 'ASSIGN_AGENT') && (
                      <TextInput
                        className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                        placeholder={a.type === 'ADD_LABEL' ? 'Label name...' : 'Agent ID...'}
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        value={a.type === 'ADD_LABEL' ? (a.payload.label ?? '') : (a.payload.agentId ?? '')}
                        onChangeText={(v) => setForm((sf) => {
                          const acts = [...sf.actions];
                          const key = a.type === 'ADD_LABEL' ? 'label' : 'agentId';
                          acts[i] = { ...acts[i]!, payload: { [key]: v } };
                          return { ...sf, actions: acts };
                        })}
                      />
                    )}
                    {form.actions.length > 1 && (
                      <TouchableOpacity
                        onPress={() => setForm((sf) => ({ ...sf, actions: sf.actions.filter((_, idx) => idx !== i) }))}
                        className="items-end mt-2"
                      >
                        <Text className="text-red-400 text-xs">Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>

              <TouchableOpacity
                className="bg-green rounded-2xl py-4 items-center mb-2"
                onPress={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Save Rule</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
