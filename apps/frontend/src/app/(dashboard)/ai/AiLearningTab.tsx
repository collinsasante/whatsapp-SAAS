'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, X, ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { aiLearningApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;
type EvalStatus = 'PENDING' | 'EVALUATED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'FAILED';

interface EvaluationFeedback {
  rating: string;
  reason: string | null;
  notes: string | null;
  expectedAction: string | null;
  expectedResponse: string | null;
  reviewer?: { id: string; name: string } | null;
}

interface Interaction {
  id: string;
  conversationId: string;
  status: EvalStatus;
  overallScore: number | null;
  dimensions: Record<string, number> | null;
  failureCategories: string[];
  severity: Severity;
  evaluatorReasoning: string | null;
  needsHumanReview: boolean;
  falseActionClaim: boolean;
  falseSuccessClaim: boolean;
  unnecessaryHandoff: boolean;
  customerCorrectionDetected: boolean;
  createdAt: string;
  feedback: EvaluationFeedback | null;
  aiExecution?: { taskType: string; modelKey: string; latencyMs: number | null };
}

interface Overview {
  windowHours: number;
  totalInteractions: number;
  byStatus: Record<string, number>;
  averageQualityScore: number | null;
  needsReviewCount: number;
  falseClaimCount: number;
  customerCorrectionCount: number;
  topFailureCategories: { category: string; count: number }[];
}

function SeverityBadge({ severity }: { severity: Severity }) {
  if (!severity) return <span className="text-gray-300 text-xs">—</span>;
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-600',
    HIGH: 'bg-amber-50 text-amber-600',
    MEDIUM: 'bg-blue-50 text-blue-600',
    LOW: 'bg-gray-100 text-gray-500',
  };
  return <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium w-fit', map[severity])}>{severity}</span>;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'danger' }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={cn('text-xl font-semibold mt-0.5', tone === 'danger' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900')}>{value}</div>
    </div>
  );
}

export default function AiLearningTab() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [selected, setSelected] = useState<Interaction | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<{ reason: string; notes: string; expectedAction: string; expectedResponse: string }>({
    reason: '', notes: '', expectedAction: '', expectedResponse: '',
  });

  const load = useCallback(async (needsReview: boolean) => {
    setLoading(true);
    try {
      const [ovRes, listRes] = await Promise.all([
        aiLearningApi.overview(),
        aiLearningApi.listInteractions({ limit: 25, needsHumanReview: needsReview || undefined }),
      ]);
      setOverview(ovRes.data as Overview);
      const data = listRes.data as { items: Interaction[]; nextCursor: string | null };
      setInteractions(data.items);
      setNextCursor(data.nextCursor);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load AI Learning data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(onlyNeedsReview); }, [load, onlyNeedsReview]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await aiLearningApi.listInteractions({ limit: 25, cursor: nextCursor, needsHumanReview: onlyNeedsReview || undefined });
      const data = res.data as { items: Interaction[]; nextCursor: string | null };
      setInteractions((prev) => [...prev, ...data.items]);
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
      const res = await aiLearningApi.getInteraction(id);
      const data = res.data as Interaction;
      setSelected(data);
      setFeedbackDraft({
        reason: data.feedback?.reason ?? '',
        notes: data.feedback?.notes ?? '',
        expectedAction: data.feedback?.expectedAction ?? '',
        expectedResponse: data.feedback?.expectedResponse ?? '',
      });
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load interaction detail');
    } finally {
      setLoadingDetail(false);
    }
  };

  const submitFeedback = async (rating: 'GOOD' | 'BAD') => {
    if (!selected) return;
    setSubmittingFeedback(true);
    try {
      await aiLearningApi.submitFeedback(selected.id, { rating, ...feedbackDraft });
      toast.success('Feedback saved');
      await openDetail(selected.id);
      await load(onlyNeedsReview);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="p-5">
      <p className="text-xs text-gray-500 mb-4">
        Automatic quality evaluation of real Verz-AI conversations — score, failure categories, and human review, feeding an approved training/regression dataset. Only runs for tenants with the AI Learning capability enabled.
      </p>

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard label={`Interactions (${overview.windowHours}h)`} value={overview.totalInteractions} />
          <StatCard label="Avg quality" value={overview.averageQualityScore !== null ? overview.averageQualityScore.toFixed(2) : '—'} />
          <StatCard label="Needs review" value={overview.needsReviewCount} tone={overview.needsReviewCount > 0 ? 'warn' : undefined} />
          <StatCard label="False claims" value={overview.falseClaimCount} tone={overview.falseClaimCount > 0 ? 'danger' : undefined} />
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setOnlyNeedsReview(false)}
          className={cn('text-xs px-3 py-1.5 rounded-lg font-medium', !onlyNeedsReview ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}
        >
          All
        </button>
        <button
          onClick={() => setOnlyNeedsReview(true)}
          className={cn('text-xs px-3 py-1.5 rounded-lg font-medium', onlyNeedsReview ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}
        >
          Needs review
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-gray-50 rounded-xl h-14 animate-pulse" />)}
        </div>
      ) : interactions.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No evaluated interactions yet — this fills in once the AI Learning capability is enabled for this tenant and Verz has handled a real conversation.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2 pr-4">Failures</th>
                <th className="py-2 pr-4">Flags</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((row) => (
                <tr key={row.id} onClick={() => openDetail(row.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{row.status}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{row.overallScore !== null ? row.overallScore.toFixed(1) : '—'}</td>
                  <td className="py-2.5 pr-4"><SeverityBadge severity={row.severity} /></td>
                  <td className="py-2.5 pr-4 text-gray-500 text-xs">{row.failureCategories.slice(0, 2).join(', ') || '—'}</td>
                  <td className="py-2.5 pr-4">
                    {(row.falseActionClaim || row.falseSuccessClaim) && <AlertTriangle size={13} className="inline text-red-500 mr-1" />}
                    {row.customerCorrectionDetected && <span className="text-[10px] text-amber-600">corrected</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {nextCursor && (
            <div className="flex justify-center py-4">
              <button onClick={loadMore} disabled={loadingMore} className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50">
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
              <h3 className="font-semibold text-gray-900">Interaction evaluation</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-sm">
              {loadingDetail && !selected ? (
                <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : selected ? (
                <>
                  {(selected.falseActionClaim || selected.falseSuccessClaim) && (
                    <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
                      <AlertTriangle size={13} /> Response may have claimed something the backend did not confirm.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="text-[11px] text-gray-400">Overall score</div><div className="text-gray-700">{selected.overallScore?.toFixed(2) ?? '—'}</div></div>
                    <div><div className="text-[11px] text-gray-400">Severity</div><SeverityBadge severity={selected.severity} /></div>
                  </div>
                  {selected.dimensions && Object.keys(selected.dimensions).length > 0 && (
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1.5">Dimension scores</div>
                      <div className="space-y-1">
                        {Object.entries(selected.dimensions).map(([dim, score]) => (
                          <div key={dim} className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">{dim.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                            <span className="text-gray-700 font-medium">{score}/5</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.evaluatorReasoning && (
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">Evaluator reasoning</div>
                      <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{selected.evaluatorReasoning}</div>
                    </div>
                  )}
                  {selected.failureCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selected.failureCategories.map((c) => (
                        <span key={c} className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">{c}</span>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-gray-100 pt-4">
                    <div className="text-[11px] text-gray-400 mb-2">Human feedback {selected.feedback && <span className="text-gray-500">— {selected.feedback.rating}</span>}</div>
                    <textarea
                      placeholder="Reviewer notes..."
                      value={feedbackDraft.notes}
                      onChange={(e) => setFeedbackDraft((d) => ({ ...d, notes: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2"
                      rows={2}
                    />
                    <textarea
                      placeholder="What should Verz have done? (expected action)"
                      value={feedbackDraft.expectedAction}
                      onChange={(e) => setFeedbackDraft((d) => ({ ...d, expectedAction: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2"
                      rows={2}
                    />
                    <textarea
                      placeholder="What should Verz have said? (expected response)"
                      value={feedbackDraft.expectedResponse}
                      onChange={(e) => setFeedbackDraft((d) => ({ ...d, expectedResponse: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-3"
                      rows={2}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => submitFeedback('GOOD')}
                        disabled={submittingFeedback}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        <ThumbsUp size={13} /> Good
                      </button>
                      <button
                        onClick={() => submitFeedback('BAD')}
                        disabled={submittingFeedback}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <ThumbsDown size={13} /> Bad
                      </button>
                      {selected.feedback && (
                        <span className="text-[11px] text-gray-400 flex items-center gap-1"><CheckCircle2 size={12} /> Reviewed{selected.feedback.reviewer ? ` by ${selected.feedback.reviewer.name}` : ''}</span>
                      )}
                    </div>
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
