'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Play, Loader2, X, AlertTriangle, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { commerceEvaluationApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
type Verdict = 'PENDING' | 'PASS' | 'FAIL';
type CaseStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERRORED';

interface CaseSummary {
  id: string;
  scenarioKey: string;
  criteria: string[];
  status: CaseStatus;
  failureReasons: string[];
  createdAt: string;
}

interface RunSummary {
  id: string;
  status: RunStatus;
  overallVerdict: Verdict;
  criticalFailure: boolean;
  scenarioCount: number;
  skippedCount: number;
  criteriaSummary: { perCriterion: Record<string, { pass: number; total: number; passRate: number }>; responseQualityAverage: number } | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  cases?: CaseSummary[];
}

interface TranscriptTurn {
  blocked: boolean;
  toolTrace: { name: string; args: unknown; result: unknown }[];
  aiResponse: string;
  customerMessage: string;
  orderStatusAfterTurn: string | null;
}

interface CaseDetail extends CaseSummary {
  transcript: TranscriptTurn[];
  scores: Record<string, { pass?: boolean; score?: number; details: string[] }>;
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, string> = {
    QUEUED: 'bg-gray-100 text-gray-600',
    RUNNING: 'bg-blue-50 text-blue-600',
    COMPLETED: 'bg-gray-100 text-gray-600',
    FAILED: 'bg-red-50 text-red-600',
  };
  return <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', map[status])}>{status}</span>;
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'PASS') return <span className="flex items-center gap-1 text-[11px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 size={10} /> PASS</span>;
  if (verdict === 'FAIL') return <span className="flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium"><XCircle size={10} /> FAIL</span>;
  return <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">PENDING</span>;
}

function CaseStatusBadge({ status }: { status: CaseStatus }) {
  if (status === 'PASSED') return <span className="flex items-center gap-1 text-[11px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 size={10} /> Passed</span>;
  if (status === 'FAILED') return <span className="flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium"><XCircle size={10} /> Failed</span>;
  if (status === 'SKIPPED') return <span className="flex items-center gap-1 text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium"><MinusCircle size={10} /> Skipped</span>;
  return <span className="flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium"><AlertTriangle size={10} /> Errored</span>;
}

export default function CommerceEvaluationPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunSummary | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [loadingCase, setLoadingCase] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await commerceEvaluationApi.list();
      const data = (res.data as { data: RunSummary[] }).data;
      setRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load evaluation runs');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRunDetail = useCallback(async (runId: string) => {
    const res = await commerceEvaluationApi.get(runId);
    const detail = res.data as RunSummary;
    setRunDetail(detail);
    setRuns(prev => prev.map(r => (r.id === runId ? { ...r, ...detail } : r)));
    return detail;
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!selectedRunId) return;

    void loadRunDetail(selectedRunId);
    pollRef.current = setInterval(async () => {
      const detail = await loadRunDetail(selectedRunId).catch(() => null);
      if (detail && (detail.status === 'COMPLETED' || detail.status === 'FAILED') && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  const triggerRun = async () => {
    setTriggering(true);
    try {
      const res = await commerceEvaluationApi.trigger();
      const run = res.data as RunSummary;
      toast.success(`Evaluation run started (${run.scenarioCount} scenarios) — this takes 1-3 minutes`);
      setRuns(prev => [run, ...prev]);
      setSelectedRunId(run.id);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start evaluation run');
    } finally {
      setTriggering(false);
    }
  };

  const openCase = async (runId: string, caseId: string) => {
    setLoadingCase(true);
    try {
      const res = await commerceEvaluationApi.getCase(runId, caseId);
      setSelectedCase(res.data as CaseDetail);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load case transcript');
    } finally {
      setLoadingCase(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center">
              <ClipboardCheck size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Evaluation Runs</h1>
              <p className="text-xs text-gray-500">Scripted conversations against the live commerce AI — check before enabling it for real customers</p>
            </div>
          </div>
          <button
            onClick={triggerRun}
            disabled={triggering}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-500 disabled:opacity-50 transition-colors font-medium"
          >
            {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Evaluation
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 h-24 animate-pulse" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No evaluation runs yet — click &quot;Run Evaluation&quot; to test the commerce AI against ~18 scripted conversations.
            </div>
          ) : (
            runs.map(run => {
              const isSelected = selectedRunId === run.id;
              const displayRun = isSelected && runDetail ? runDetail : run;
              return (
                <div key={run.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setSelectedRunId(isSelected ? null : run.id)}
                    className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <code className="text-xs text-gray-400 shrink-0">{run.id.slice(0, 8)}</code>
                      <StatusBadge status={displayRun.status} />
                      <VerdictBadge verdict={displayRun.overallVerdict} />
                      {displayRun.criticalFailure && (
                        <span className="flex items-center gap-1 text-[11px] bg-red-600 text-white px-2 py-0.5 rounded-full font-semibold">
                          <AlertTriangle size={10} /> CRITICAL
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">
                      {new Date(run.createdAt).toLocaleString()}
                    </div>
                  </button>

                  {isSelected && (
                    <div className="border-t border-gray-100 p-5 space-y-4">
                      {displayRun.status === 'QUEUED' || displayRun.status === 'RUNNING' ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" /> Running scenarios ({displayRun.cases?.length ?? 0}/{displayRun.scenarioCount} done so far)...
                        </div>
                      ) : null}

                      {displayRun.errorMessage && (
                        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{displayRun.errorMessage}</div>
                      )}

                      {displayRun.criteriaSummary && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(displayRun.criteriaSummary.perCriterion).map(([criterion, stat]) => (
                            <div key={criterion} className="border border-gray-100 rounded-lg px-3 py-2">
                              <div className="text-[11px] text-gray-400">{criterion.replace(/_/g, ' ')}</div>
                              <div className={cn('text-sm font-semibold', stat.passRate === 1 ? 'text-green-600' : 'text-red-600')}>
                                {stat.pass}/{stat.total}
                              </div>
                            </div>
                          ))}
                          <div className="border border-gray-100 rounded-lg px-3 py-2">
                            <div className="text-[11px] text-gray-400">response quality</div>
                            <div className="text-sm font-semibold text-gray-700">{displayRun.criteriaSummary.responseQualityAverage.toFixed(1)}/5</div>
                          </div>
                        </div>
                      )}

                      {displayRun.cases && displayRun.cases.length > 0 && (
                        <div className="space-y-1.5">
                          {displayRun.cases.map(c => (
                            <button
                              key={c.id}
                              onClick={() => openCase(run.id, c.id)}
                              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                            >
                              <span className="text-sm text-gray-700 truncate">{c.scenarioKey.replace(/_/g, ' ')}</span>
                              <CaseStatusBadge status={c.status} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {(selectedCase || loadingCase) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelectedCase(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{selectedCase ? selectedCase.scenarioKey.replace(/_/g, ' ') : 'Loading...'}</h3>
                {selectedCase && <CaseStatusBadge status={selectedCase.status} />}
              </div>
              <button onClick={() => setSelectedCase(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {loadingCase && !selectedCase ? (
                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading transcript...</div>
              ) : selectedCase ? (
                <>
                  {selectedCase.failureReasons.length > 0 && (
                    <div className="bg-red-50 rounded-lg px-3 py-2 space-y-1">
                      {selectedCase.failureReasons.map((reason, i) => (
                        <div key={i} className="text-xs text-red-600">{reason}</div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-3">
                    {selectedCase.transcript.map((turn, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-end">
                          <div className="bg-teal-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%]">
                            {turn.customerMessage}
                          </div>
                        </div>
                        {turn.toolTrace.length > 0 && (
                          <div className="flex flex-col items-start gap-1">
                            {turn.toolTrace.map((tool, ti) => (
                              <code key={ti} className="text-[11px] bg-gray-100 text-gray-500 rounded px-2 py-1">
                                {tool.name}({JSON.stringify(tool.args)}) → {JSON.stringify(tool.result)}
                              </code>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-start">
                          <div className={cn(
                            'text-sm rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]',
                            turn.aiResponse ? 'bg-gray-100 text-gray-800' : 'bg-red-50 text-red-500 italic',
                          )}>
                            {turn.aiResponse || '(empty response)'}
                          </div>
                        </div>
                        {turn.orderStatusAfterTurn && (
                          <div className="text-[11px] text-gray-400">Order status at this point: {turn.orderStatusAfterTurn}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
