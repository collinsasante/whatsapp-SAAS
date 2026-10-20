import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { Badge, BottomSheet, EmptyState, ErrorState, type BadgeTone } from '../ui';

type ExecutionStatus = 'SUCCESS' | 'BLOCKED' | 'POLICY_REJECTED' | 'PROVIDER_ERROR' | 'EMPTY';

interface SanitizedToolCall {
  name: string;
  order: number;
  success: boolean;
  errorMessage?: string;
  durationMs: number | null;
}

interface Execution {
  id: string;
  taskType: string;
  provider: string;
  modelKey: string;
  status: ExecutionStatus;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estCostUsd: number | null;
  confidence: number | null;
  errorMessage: string | null;
  stageTimings: Record<string, number> | null;
  toolTrace: SanitizedToolCall[] | null;
  safetyFlags: { injectionDetected?: boolean; fallbackCapped?: boolean; emptyOutput?: boolean } | null;
  createdAt: string;
}

interface Page {
  items: Execution[];
  nextCursor: string | null;
}

const STATUS_BADGE: Record<ExecutionStatus, { label: string; tone: BadgeTone }> = {
  SUCCESS: { label: 'Success', tone: 'green' },
  BLOCKED: { label: 'Blocked', tone: 'orange' },
  POLICY_REJECTED: { label: 'Policy rejected', tone: 'orange' },
  PROVIDER_ERROR: { label: 'Provider error', tone: 'red' },
  EMPTY: { label: 'Empty', tone: 'neutral' },
};

function formatCost(estCostUsd: number | null): string {
  if (estCostUsd === null || estCostUsd === undefined) return '-';
  if (estCostUsd < 0.0001) return '<$0.0001';
  return `$${estCostUsd.toFixed(4)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-light-text-muted dark:text-white/40 text-xs">{label}</Text>
      <Text className="text-light-text-primary dark:text-white text-xs font-medium flex-shrink ml-3" numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Read-only trace list of every Verz AI run, matching the web Activity tab. */
export function AiActivityTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['ai', 'executions'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiClient.aiExecutions.list({ limit: 25, cursor: pageParam }).then((r) => r.data as Page),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const detail = useQuery({
    queryKey: ['ai', 'executions', selectedId],
    queryFn: () => apiClient.aiExecutions.get(selectedId as string).then((r) => r.data as Execution),
    enabled: selectedId !== null,
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sel = detail.data;

  if (list.isLoading) return <ActivityIndicator color="#25D366" />;
  if (list.isError) return <ErrorState message="Could not load AI activity" onRetry={() => { void list.refetch(); }} />;

  return (
    <>
      <Text className="text-light-text-muted dark:text-white/40 text-xs mb-3">
        Every Verz AI run with its tokens, cost and latency.
      </Text>

      {items.length === 0 ? (
        <EmptyState icon="pulse-outline" title="No AI activity yet" description="Runs appear here once Verz AI has handled a conversation." />
      ) : (
        <View className="gap-2">
          {items.map((row) => {
            const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.EMPTY;
            return (
              <TouchableOpacity
                key={row.id}
                activeOpacity={0.8}
                onPress={() => setSelectedId(row.id)}
                className="bg-light-card dark:bg-surface-card border border-light-border dark:border-white/5 rounded-2xl p-4"
              >
                <View className="flex-row items-center justify-between mb-1">
                  <Badge label={badge.label} tone={badge.tone} />
                  <Text className="text-light-text-muted dark:text-white/40 text-xs">{new Date(row.createdAt).toLocaleString()}</Text>
                </View>
                <Text className="text-light-text-primary dark:text-white text-sm font-medium" numberOfLines={1}>
                  {row.taskType} · {row.modelKey}
                </Text>
                <Text className="text-light-text-muted dark:text-white/40 text-xs mt-0.5">
                  {row.latencyMs !== null ? `${row.latencyMs}ms` : '-'} · {formatCost(row.estCostUsd)}
                </Text>
              </TouchableOpacity>
            );
          })}
          {list.hasNextPage && (
            <TouchableOpacity
              onPress={() => { void list.fetchNextPage(); }}
              disabled={list.isFetchingNextPage}
              className="items-center py-3"
            >
              {list.isFetchingNextPage
                ? <ActivityIndicator size="small" color="#25D366" />
                : <Text className="text-green text-sm font-semibold">Load more</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}

      <BottomSheet visible={selectedId !== null} onClose={() => setSelectedId(null)} title="Run details" maxHeightPct={80}>
        <ScrollView className="px-5 pb-8" contentContainerStyle={{ paddingBottom: 32 }}>
          {detail.isLoading ? (
            <ActivityIndicator color="#25D366" />
          ) : detail.isError || !sel ? (
            <ErrorState message="Could not load this run" onRetry={() => { void detail.refetch(); }} />
          ) : (
            <>
              <Row label="Status" value={(STATUS_BADGE[sel.status] ?? STATUS_BADGE.EMPTY).label} />
              <Row label="Provider" value={sel.provider} />
              <Row label="Model" value={sel.modelKey} />
              <Row label="Latency" value={sel.latencyMs !== null ? `${sel.latencyMs}ms` : '-'} />
              <Row label="Tokens in / out" value={`${sel.inputTokens ?? '-'} / ${sel.outputTokens ?? '-'}`} />
              <Row label="Estimated cost" value={formatCost(sel.estCostUsd)} />
              <Row label="Confidence" value={sel.confidence !== null ? sel.confidence.toFixed(2) : '-'} />
              {sel.safetyFlags?.injectionDetected && <Row label="Safety" value="Injection attempt detected" />}
              {sel.errorMessage && (
                <Text className="text-red-500 text-xs mt-2">{sel.errorMessage}</Text>
              )}
              {sel.stageTimings && Object.keys(sel.stageTimings).length > 0 && (
                <View className="mt-3">
                  <Text className="text-light-text-muted dark:text-white/40 text-xs uppercase tracking-wider mb-1">Stage timings</Text>
                  {Object.entries(sel.stageTimings).map(([stage, ms]) => (
                    <Row key={stage} label={stage} value={`${ms}ms`} />
                  ))}
                </View>
              )}
              {sel.toolTrace && sel.toolTrace.length > 0 && (
                <View className="mt-3">
                  <Text className="text-light-text-muted dark:text-white/40 text-xs uppercase tracking-wider mb-1">Tool calls</Text>
                  {sel.toolTrace.map((call) => (
                    <View key={`${call.order}-${call.name}`} className="flex-row items-center justify-between py-1.5">
                      <Text className="text-light-text-primary dark:text-white text-xs flex-1" numberOfLines={1}>{call.name}</Text>
                      <Badge label={call.success ? 'Success' : 'Failed'} tone={call.success ? 'green' : 'red'} />
                      <Text className="text-light-text-muted dark:text-white/40 text-xs ml-2 w-14 text-right">
                        {call.durationMs !== null ? `${call.durationMs}ms` : '-'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}
