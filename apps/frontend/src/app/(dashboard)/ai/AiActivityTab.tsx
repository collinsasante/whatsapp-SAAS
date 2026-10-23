'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, X, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { aiExecutionsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type ExecutionStatus = 'SUCCESS' | 'BLOCKED' | 'POLICY_REJECTED' | 'PROVIDER_ERROR' | 'EMPTY';

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
  errorCode: string | null;
  errorMessage: string | null;
  stageTimings: Record<string, number> | null;
  safetyFlags: { injectionDetected?: boolean; fallbackCapped?: boolean; emptyOutput?: boolean } | null;
  conversationId: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const map: Record<ExecutionStatus, { cls: string; icon: JSX.Element; label: string }> = {
    SUCCESS: { cls: 'bg-green-50 text-green-600', icon: <CheckCircle2 size={10} />, label: 'Success' },
    BLOCKED: { cls: 'bg-amber-50 text-amber-600', icon: <AlertTriangle size={10} />, label: 'Blocked' },
    POLICY_REJECTED: { cls: 'bg-amber-50 text-amber-600', icon: <AlertTriangle size={10} />, label: 'Policy rejected' },
    PROVIDER_ERROR: { cls: 'bg-red-50 text-red-600', icon: <XCircle size={10} />, label: 'Provider error' },
    EMPTY: { cls: 'bg-gray-100 text-gray-500', icon: <MinusCircle size={10} />, label: 'Empty' },
  };
  const m = map[status] ?? map.EMPTY;
  return (
    <span className={cn('flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium w-fit', m.cls)}>
      {m.icon} {m.label}
    </span>
  );
}

function formatCost(estCostUsd: number | null): string {
  if (estCostUsd === null || estCostUsd === undefined) return '—';
  if (estCostUsd < 0.0001) return '<$0.0001';
  return `$${estCostUsd.toFixed(4)}`;
}

export default function AiActivityTab() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await aiExecutionsApi.list({ limit: 25 });
      const data = res.data as { items: Execution[]; nextCursor: string | null };
      setExecutions(data.items);
      setNextCursor(data.nextCursor);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load AI activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await aiExecutionsApi.list({ limit: 25, cursor: nextCursor });
      const data = res.data as { items: Execution[]; nextCursor: string | null };
      setExecutions((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const openDetail = async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await aiExecutionsApi.get(id);
      setSelected(res.data as Execution);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load trace detail');
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="p-5">
      <p className="text-xs text-gray-500 mb-4">
        Every Verz-AI v2 pipeline run (and completion call from summarize / knowledge-base learning), with tokens, cost, latency, and stage-by-stage timing.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      ) : executions.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No AI executions yet — this fills in once the Verz-AI v2 pipeline is enabled and has handled a message.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Task</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2 pr-4">Confidence</th>
                <th className="py-2 pr-4">Latency</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => openDetail(e.id)}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{e.taskType}</td>
                  <td className="py-2.5 pr-4"><StatusBadge status={e.status} /></td>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{e.modelKey}</td>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">
                    {e.inputTokens !== null ? `${e.inputTokens} in / ${e.outputTokens} out` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500">{formatCost(e.estCostUsd)}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{e.confidence !== null ? `${e.confidence}%` : '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{e.latencyMs !== null ? `${e.latencyMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {nextCursor && (
            <div className="flex justify-center py-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {(selected || loadingDetail) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">Execution trace</h3>
                {selected && <StatusBadge status={selected.status} />}
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-sm">
              {loadingDetail && !selected ? (
                <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : selected ? (
                <>
                  {selected.errorMessage && (
                    <div className="bg-red-50 rounded-lg px-3 py-2 text-xs text-red-600">
                      [{selected.errorCode}] {selected.errorMessage}
                    </div>
                  )}
                  {selected.safetyFlags && Object.keys(selected.safetyFlags).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selected.safetyFlags.injectionDetected && (
                        <span className="text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">Injection detected</span>
                      )}
                      {selected.safetyFlags.fallbackCapped && (
                        <span className="text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">Confidence capped (knowledge gap)</span>
                      )}
                      {selected.safetyFlags.emptyOutput && (
                        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Empty output</span>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="text-[11px] text-gray-400">Task</div><div className="text-gray-700">{selected.taskType}</div></div>
                    <div><div className="text-[11px] text-gray-400">Provider / Model</div><div className="text-gray-700">{selected.provider} / {selected.modelKey}</div></div>
                    <div><div className="text-[11px] text-gray-400">Tokens</div><div className="text-gray-700">{selected.inputTokens ?? '—'} in / {selected.outputTokens ?? '—'} out</div></div>
                    <div><div className="text-[11px] text-gray-400">Est. cost</div><div className="text-gray-700">{formatCost(selected.estCostUsd)}</div></div>
                    <div><div className="text-[11px] text-gray-400">Confidence</div><div className="text-gray-700">{selected.confidence !== null ? `${selected.confidence}%` : '—'}</div></div>
                    <div><div className="text-[11px] text-gray-400">Total latency</div><div className="text-gray-700">{selected.latencyMs !== null ? `${selected.latencyMs}ms` : '—'}</div></div>
                  </div>
                  {selected.stageTimings && Object.keys(selected.stageTimings).length > 0 && (
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1.5">Stage timings</div>
                      <div className="space-y-1">
                        {Object.entries(selected.stageTimings).map(([stage, ms]) => (
                          <div key={stage} className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">{stage.replace(/_/g, ' ')}</span>
                            <span className="text-gray-700 font-medium">{ms}ms</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
