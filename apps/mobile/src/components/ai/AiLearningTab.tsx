import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, Alert } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useAppTheme } from '../../theme/useAppTheme';
import { Badge, BottomSheet, EmptyState, ErrorState, FilterChip, StatCard, type BadgeTone } from '../ui';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;

interface Interaction {
  id: string;
  status: string;
  overallScore: number | null;
  dimensions: Record<string, number> | null;
  failureCategories: string[];
  severity: Severity;
  evaluatorReasoning: string | null;
  needsHumanReview: boolean;
  falseActionClaim: boolean;
  falseSuccessClaim: boolean;
  customerCorrectionDetected: boolean;
  createdAt: string;
  feedback: {
    rating: string;
    reason: string | null;
    notes: string | null;
    expectedAction: string | null;
    expectedResponse: string | null;
    reviewer?: { id: string; name: string } | null;
  } | null;
}

interface Overview {
  windowHours: number;
  totalInteractions: number;
  averageQualityScore: number | null;
  needsReviewCount: number;
  falseClaimCount: number;
}

interface Page {
  items: Interaction[];
  nextCursor: string | null;
}

const SEVERITY_TONE: Record<string, BadgeTone> = { CRITICAL: 'red', HIGH: 'orange', MEDIUM: 'blue', LOW: 'neutral' };

const EMPTY_DRAFT = { notes: '', expectedAction: '', expectedResponse: '' };

function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

/** Quality review of real Verz AI conversations, matching the web Learning tab (list, detail, human feedback). */
export function AiLearningTab() {
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const overview = useQuery({
    queryKey: ['ai', 'learning', 'overview'],
    queryFn: () => apiClient.aiLearning.overview().then((r) => r.data as Overview),
  });

  const list = useInfiniteQuery({
    queryKey: ['ai', 'learning', 'interactions', onlyNeedsReview],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiClient.aiLearning
        .listInteractions({ limit: 25, cursor: pageParam, needsHumanReview: onlyNeedsReview || undefined })
        .then((r) => r.data as Page),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const detail = useQuery({
    queryKey: ['ai', 'learning', 'interaction', selectedId],
    queryFn: () => apiClient.aiLearning.getInteraction(selectedId as string).then((r) => r.data as Interaction),
    enabled: selectedId !== null,
  });

  const sel = detail.data;
  useEffect(() => {
    if (!sel) return;
    setDraft({
      notes: sel.feedback?.notes ?? '',
      expectedAction: sel.feedback?.expectedAction ?? '',
      expectedResponse: sel.feedback?.expectedResponse ?? '',
    });
  }, [sel]);

  const feedback = useMutation({
    mutationFn: (rating: 'GOOD' | 'BAD') =>
      apiClient.aiLearning.submitFeedback(selectedId as string, { rating, ...draft }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai', 'learning'] });
    },
    onError: (e) => Alert.alert('Could not save feedback', errorMessage(e, 'Please try again.')),
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const ov = overview.data;

  return (
    <>
      <Text className="text-light-text-muted dark:text-white/40 text-xs mb-3">
        Automatic quality checks of real Verz AI conversations, with human review. Only runs when AI Learning is enabled for your workspace.
      </Text>

      {ov && (
        <View className="flex-row gap-3 mb-3">
          <StatCard label={`Interactions (${ov.windowHours}h)`} value={ov.totalInteractions} />
          <StatCard label="Avg quality" value={ov.averageQualityScore !== null ? ov.averageQualityScore.toFixed(2) : '-'} />
        </View>
      )}
      {ov && (
        <View className="flex-row gap-3 mb-4">
          <StatCard label="Needs review" value={ov.needsReviewCount} urgent={ov.needsReviewCount > 0} />
          <StatCard label="False claims" value={ov.falseClaimCount} urgent={ov.falseClaimCount > 0} color="#ef4444" />
        </View>
      )}

      <View className="flex-row gap-2 mb-3">
        <FilterChip label="All" active={!onlyNeedsReview} onPress={() => setOnlyNeedsReview(false)} />
        <FilterChip label="Needs review" active={onlyNeedsReview} onPress={() => setOnlyNeedsReview(true)} />
      </View>

      {list.isLoading ? (
        <ActivityIndicator color="#25D366" />
      ) : list.isError ? (
        <ErrorState message="Could not load evaluations" onRetry={() => { void list.refetch(); }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="school-outline"
          title="No evaluated interactions yet"
          description="This fills in once AI Learning is enabled and Verz AI has handled a real conversation."
        />
      ) : (
        <View className="gap-2">
          {items.map((row) => (
            <TouchableOpacity
              key={row.id}
              activeOpacity={0.8}
              onPress={() => { feedback.reset(); setSelectedId(row.id); }}
              className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/5 rounded-2xl p-4"
            >
              <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center gap-2">
                  {row.severity && <Badge label={row.severity} tone={SEVERITY_TONE[row.severity] ?? 'neutral'} />}
                  {row.needsHumanReview && <Badge label="Review" tone="yellow" />}
                </View>
                <Text className="text-light-text-primary dark:text-white text-sm font-semibold">
                  {row.overallScore !== null ? row.overallScore.toFixed(1) : '-'}
                </Text>
              </View>
              <Text className="text-light-text-muted dark:text-white/40 text-xs">
                {new Date(row.createdAt).toLocaleString()} · {row.status.replace('_', ' ').toLowerCase()}
              </Text>
              {row.failureCategories.length > 0 && (
                <Text className="text-light-text-secondary dark:text-white/60 text-xs mt-1" numberOfLines={1}>
                  {row.failureCategories.slice(0, 2).join(', ')}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          {list.hasNextPage && (
            <TouchableOpacity onPress={() => { void list.fetchNextPage(); }} disabled={list.isFetchingNextPage} className="items-center py-3">
              {list.isFetchingNextPage
                ? <ActivityIndicator size="small" color="#25D366" />
                : <Text className="text-green text-sm font-semibold">Load more</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}

      <BottomSheet visible={selectedId !== null} onClose={() => setSelectedId(null)} title="Interaction evaluation" maxHeightPct={90}>
        <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {detail.isLoading ? (
            <ActivityIndicator color="#25D366" />
          ) : detail.isError || !sel ? (
            <ErrorState message="Could not load this evaluation" onRetry={() => { void detail.refetch(); }} />
          ) : (
            <>
              {(sel.falseActionClaim || sel.falseSuccessClaim) && (
                <View className="bg-red/15 rounded-xl px-3 py-2 mb-3">
                  <Text className="text-red-500 text-xs">The response may have claimed something the backend did not confirm.</Text>
                </View>
              )}
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-light-text-primary dark:text-white text-sm">
                  Score {sel.overallScore !== null ? sel.overallScore.toFixed(2) : '-'}
                </Text>
                {sel.severity && <Badge label={sel.severity} tone={SEVERITY_TONE[sel.severity] ?? 'neutral'} />}
              </View>
              {sel.dimensions && Object.entries(sel.dimensions).map(([dim, score]) => (
                <View key={dim} className="flex-row items-center justify-between py-1">
                  <Text className="text-light-text-muted dark:text-white/40 text-xs">{dim.replace(/([A-Z])/g, ' $1').toLowerCase()}</Text>
                  <Text className="text-light-text-primary dark:text-white text-xs font-medium">{score}/5</Text>
                </View>
              ))}
              {sel.evaluatorReasoning && (
                <Text className="text-light-text-secondary dark:text-white/60 text-xs mt-3 leading-5">{sel.evaluatorReasoning}</Text>
              )}
              {sel.failureCategories.length > 0 && (
                <View className="flex-row flex-wrap gap-1.5 mt-3">
                  {sel.failureCategories.map((c) => <Badge key={c} label={c} tone="yellow" />)}
                </View>
              )}

              <View className="border-t border-light-border dark:border-white/5 mt-4 pt-4">
                <Text className="text-light-text-muted dark:text-white/40 text-xs uppercase tracking-wider mb-2">
                  Human feedback{sel.feedback ? ` (${sel.feedback.rating.toLowerCase()}${sel.feedback.reviewer ? ` by ${sel.feedback.reviewer.name}` : ''})` : ''}
                </Text>
                {([
                  ['notes', 'Reviewer notes'],
                  ['expectedAction', 'What should Verz have done?'],
                  ['expectedResponse', 'What should Verz have said?'],
                ] as const).map(([key, placeholder]) => (
                  <TextInput
                    key={key}
                    value={draft[key]}
                    onChangeText={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textDisabled}
                    multiline
                    className="bg-light-background dark:bg-surface border border-light-border dark:border-white/10 rounded-xl px-3.5 py-3 text-light-text-primary dark:text-white text-sm mb-2"
                    style={{ minHeight: 56, textAlignVertical: 'top' }}
                  />
                ))}
                <View className="flex-row gap-2 mt-1">
                  <TouchableOpacity
                    onPress={() => feedback.mutate('GOOD')}
                    disabled={feedback.isPending}
                    className="flex-1 bg-green rounded-xl py-3 items-center"
                    activeOpacity={0.8}
                  >
                    <Text className="text-white font-semibold text-sm">Good</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => feedback.mutate('BAD')}
                    disabled={feedback.isPending}
                    className="flex-1 bg-red rounded-xl py-3 items-center"
                    activeOpacity={0.8}
                  >
                    <Text className="text-white font-semibold text-sm">Bad</Text>
                  </TouchableOpacity>
                </View>
                {feedback.isSuccess && <Text className="text-green text-xs mt-2">Feedback saved.</Text>}
              </View>
            </>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}
