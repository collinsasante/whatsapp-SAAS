import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Switch, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Article {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  source: string;
  createdAt: string;
}

interface AiSettings {
  aiEnabled?: boolean;
  aiAlwaysOn?: boolean;
  aiPersonality?: string;
  aiMode?: string;
}

interface ManageSettings {
  aiEnabled?: boolean;
  aiAlwaysOn?: boolean;
  aiPersonality?: string;
  aiMode?: string;
}

interface AiAnalytics {
  total: number;
  sent: number;
  approved: number;
  approvalRate: number;
  editRate: number;
  rejectionRate: number;
  avgResponseMs: number;
  avgConfidence: number;
}

const AI_TABS = ['Knowledge Base', 'Analytics'] as const;

const PERSONALITIES = [
  'Professional & Formal',
  'Friendly & Casual',
  'Concise & Direct',
  'Empathetic & Supportive',
];

export default function AiScreen() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<(typeof AI_TABS)[number]>('Knowledge Base');
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [articleForm, setArticleForm] = useState({ title: '', content: '', isActive: true });

  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings } = useQuery({
    queryKey: ['ai', 'settings'],
    queryFn: () => apiClient.manageSettings.get().then((r) => r.data as { data: ManageSettings } | ManageSettings),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: ManageSettings }).data : raw) as ManageSettings,
  });

  const { data: articles, isLoading: kbLoading, refetch: refetchKb } = useQuery({
    queryKey: ['ai', 'knowledge-base'],
    queryFn: () => apiClient.knowledgeBase.list().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: Article[] }).data ?? [])) as Article[],
  });

  const { data: analytics } = useQuery({
    queryKey: ['ai', 'analytics'],
    queryFn: () => apiClient.ai.analytics().then((r) => r.data as AiAnalytics | { data: AiAnalytics }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: AiAnalytics }).data : raw) as AiAnalytics,
    enabled: activeTab === 'Analytics',
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: AiSettings) => apiClient.manageSettings.updateAi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'settings'] }),
    onError: () => Alert.alert('Error', 'Failed to update AI settings.'),
  });

  const createArticleMutation = useMutation({
    mutationFn: (data: { title: string; content: string; isActive: boolean }) =>
      apiClient.knowledgeBase.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'knowledge-base'] });
      setShowArticleModal(false);
      setArticleForm({ title: '', content: '', isActive: true });
    },
    onError: () => Alert.alert('Error', 'Failed to save article.'),
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Article> }) =>
      apiClient.knowledgeBase.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'knowledge-base'] });
      setShowArticleModal(false);
      setEditingArticle(null);
      setArticleForm({ title: '', content: '', isActive: true });
    },
    onError: () => Alert.alert('Error', 'Failed to update article.'),
  });

  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => apiClient.knowledgeBase.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'knowledge-base'] }),
    onError: () => Alert.alert('Error', 'Failed to delete article.'),
  });

  const learnMutation = useMutation({
    mutationFn: () => apiClient.knowledgeBase.learn(),
    onSuccess: () => Alert.alert('Learning Started', 'Verz AI is learning from your recent conversations.'),
    onError: () => Alert.alert('Error', 'Failed to start learning.'),
  });

  const handleSaveArticle = () => {
    if (!articleForm.title.trim() || !articleForm.content.trim()) {
      Alert.alert('Required', 'Please fill in both title and content.');
      return;
    }
    if (editingArticle) {
      updateArticleMutation.mutate({ id: editingArticle.id, data: articleForm });
    } else {
      createArticleMutation.mutate(articleForm);
    }
  };

  const openEdit = (article: Article) => {
    setEditingArticle(article);
    setArticleForm({ title: article.title, content: article.content, isActive: article.isActive });
    setShowArticleModal(true);
  };

  const handleDeleteConfirm = (id: string) => {
    Alert.alert('Delete Article', 'This article will be removed from the knowledge base.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteArticleMutation.mutate(id) },
    ]);
  };

  const isEnabled = settings?.aiEnabled ?? false;
  const isAlwaysOn = settings?.aiAlwaysOn ?? false;
  const aiMode = settings?.aiMode ?? 'SUGGESTION';

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles" size={20} color="#25D366" />
          <Text className="text-white text-xl font-bold">Verz AI</Text>
        </View>
        {isEnabled && (
          <View className="bg-green/20 rounded-full px-3 py-1 flex-row items-center gap-1.5">
            <View className="w-1.5 h-1.5 rounded-full bg-green" />
            <Text className="text-green text-xs font-semibold">Active</Text>
          </View>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={settingsLoading || kbLoading} onRefresh={() => { refetchSettings(); refetchKb(); }} tintColor="#25D366" />
        }
      >
        {/* AI Settings card */}
        <View className="bg-surface-card rounded-2xl border border-white/5 mb-4 overflow-hidden">
          <View className="px-4 py-3 border-b border-white/5 flex-row items-center justify-between">
            <Text className="text-white font-semibold">Verz AI Settings</Text>
            <Switch
              value={isEnabled}
              onValueChange={(v) => updateSettingsMutation.mutate({ aiEnabled: v })}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#25D366' }}
              thumbColor="#fff"
            />
          </View>

          {isEnabled && (
            <>
              {/* When should AI reply */}
              <View className="px-4 py-4 border-b border-white/5">
                <Text className="text-white/50 text-xs mb-3 uppercase tracking-wider">When should Verz reply</Text>
                <View className="flex-row gap-2">
                  {[
                    { label: 'After Hours Only', value: false },
                    { label: 'Always On', value: true },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => updateSettingsMutation.mutate({ aiAlwaysOn: opt.value })}
                      className={`flex-1 py-2 rounded-xl items-center ${isAlwaysOn === opt.value ? 'bg-green' : 'bg-surface border border-white/10'}`}
                    >
                      <Text className={`text-sm font-semibold ${isAlwaysOn === opt.value ? 'text-white' : 'text-white/50'}`}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Response mode */}
              <View className="px-4 py-4 border-b border-white/5">
                <Text className="text-white/50 text-xs mb-3 uppercase tracking-wider">Response Mode</Text>
                <View className="flex-row gap-2">
                  {[
                    { label: 'Suggestion', value: 'SUGGESTION' },
                    { label: 'Auto-Reply', value: 'AUTO_REPLY' },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => updateSettingsMutation.mutate({ aiMode: opt.value })}
                      className={`flex-1 py-2 rounded-xl items-center ${aiMode === opt.value ? 'bg-green' : 'bg-surface border border-white/10'}`}
                    >
                      <Text className={`text-sm font-semibold ${aiMode === opt.value ? 'text-white' : 'text-white/50'}`}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Personality */}
              <View className="px-4 py-4">
                <Text className="text-white/50 text-xs mb-3 uppercase tracking-wider">AI Personality</Text>
                <View className="flex-row flex-wrap gap-2">
                  {PERSONALITIES.map((p) => {
                    const active = settings?.aiPersonality === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => updateSettingsMutation.mutate({ aiPersonality: p })}
                        className={`rounded-full px-3 py-1.5 ${active ? 'bg-green' : 'bg-surface border border-white/10'}`}
                      >
                        <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-white/50'}`}>{p}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </View>

        {/* Tabs */}
        <View className="flex-row bg-surface-card rounded-xl p-1 mb-4">
          {AI_TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg items-center ${activeTab === tab ? 'bg-green' : ''}`}
            >
              <Text className={`text-sm font-semibold ${activeTab === tab ? 'text-white' : 'text-white/40'}`}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'Knowledge Base' && (
          <>
            <View className="flex-row gap-2 mb-4">
              <TouchableOpacity
                className="flex-1 bg-green rounded-xl py-3 items-center flex-row justify-center gap-2"
                onPress={() => {
                  setEditingArticle(null);
                  setArticleForm({ title: '', content: '', isActive: true });
                  setShowArticleModal(true);
                }}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text className="text-white font-semibold">Add Article</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="bg-surface-card border border-white/10 rounded-xl py-3 px-4 items-center flex-row gap-2"
                onPress={() => learnMutation.mutate()}
                disabled={learnMutation.isPending}
              >
                {learnMutation.isPending ? (
                  <ActivityIndicator size="small" color="#25D366" />
                ) : (
                  <Ionicons name="refresh" size={16} color="#25D366" />
                )}
                <Text className="text-green text-sm font-semibold">Learn</Text>
              </TouchableOpacity>
            </View>

            {kbLoading ? (
              <ActivityIndicator color="#25D366" />
            ) : (articles ?? []).length === 0 ? (
              <View className="items-center py-8">
                <Ionicons name="library-outline" size={40} color="rgba(255,255,255,0.1)" />
                <Text className="text-white/30 text-sm mt-3">No articles yet</Text>
                <Text className="text-white/20 text-xs mt-1">Add articles to teach Verz AI about your business</Text>
              </View>
            ) : (
              (articles ?? []).map((article) => (
                <View key={article.id} className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-3">
                  <View className="flex-row items-start gap-3">
                    <Switch
                      value={article.isActive}
                      onValueChange={(v) =>
                        updateArticleMutation.mutate({ id: article.id, data: { isActive: v } })
                      }
                      trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#25D366' }}
                      thumbColor="#fff"
                      style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                    />
                    <View className="flex-1 min-w-0">
                      <Text className="text-white font-semibold text-sm" numberOfLines={1}>{article.title}</Text>
                      <Text className="text-white/40 text-xs mt-0.5" numberOfLines={2}>{article.content}</Text>
                      <View className="flex-row items-center gap-2 mt-2">
                        <View className="bg-surface rounded-full px-2 py-0.5">
                          <Text className="text-white/30 text-[10px] capitalize">{article.source}</Text>
                        </View>
                      </View>
                    </View>
                    <View className="flex-row gap-1">
                      <TouchableOpacity onPress={() => openEdit(article)} className="p-1.5">
                        <Ionicons name="pencil-outline" size={16} color="rgba(255,255,255,0.4)" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteConfirm(article.id)} className="p-1.5">
                        <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.3)" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {activeTab === 'Analytics' && analytics && (
          <>
            <View className="flex-row flex-wrap gap-3 mb-4">
              {[
                { label: 'Total', value: analytics.total, color: '#fff' },
                { label: 'Approval Rate', value: `${Math.round(analytics.approvalRate ?? 0)}%`, color: '#25D366' },
                { label: 'Edit Rate', value: `${Math.round(analytics.editRate ?? 0)}%`, color: '#f97316' },
                { label: 'Rejection', value: `${Math.round(analytics.rejectionRate ?? 0)}%`, color: '#ef4444' },
                { label: 'Avg Response', value: analytics.avgResponseMs ? `${(analytics.avgResponseMs / 1000).toFixed(1)}s` : '-', color: '#3b82f6' },
                { label: 'Avg Confidence', value: `${Math.round((analytics.avgConfidence ?? 0) * 100)}%`, color: '#a855f7' },
              ].map((stat) => (
                <View key={stat.label} className="bg-surface-card rounded-2xl p-3 border border-white/5" style={{ width: '47%' }}>
                  <Text className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</Text>
                  <Text className="text-white/40 text-xs mt-0.5">{stat.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Article editor modal */}
      <Modal visible={showArticleModal} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-surface rounded-t-3xl p-6" style={{ maxHeight: '85%' }}>
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white text-lg font-bold">
                {editingArticle ? 'Edit Article' : 'New Article'}
              </Text>
              <TouchableOpacity onPress={() => setShowArticleModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="mb-4">
                <Text className="text-white/50 text-xs mb-1.5">Title</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="Article title..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={articleForm.title}
                  onChangeText={(v) => setArticleForm((f) => ({ ...f, title: v }))}
                />
              </View>
              <View className="mb-4">
                <Text className="text-white/50 text-xs mb-1.5">Content</Text>
                <TextInput
                  className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white"
                  placeholder="Write the knowledge content here..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={articleForm.content}
                  onChangeText={(v) => setArticleForm((f) => ({ ...f, content: v }))}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  style={{ minHeight: 140 }}
                />
              </View>
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-white/50 text-sm">Active</Text>
                <Switch
                  value={articleForm.isActive}
                  onValueChange={(v) => setArticleForm((f) => ({ ...f, isActive: v }))}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#25D366' }}
                  thumbColor="#fff"
                />
              </View>

              <TouchableOpacity
                className="bg-green rounded-2xl py-4 items-center"
                onPress={handleSaveArticle}
                disabled={createArticleMutation.isPending || updateArticleMutation.isPending}
              >
                {(createArticleMutation.isPending || updateArticleMutation.isPending) ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Save Article</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
