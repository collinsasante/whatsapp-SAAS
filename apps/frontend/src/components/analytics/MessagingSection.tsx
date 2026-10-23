'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BarChart3, ShieldAlert } from 'lucide-react';
import { analyticsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// These two panels (campaign funnels and WhatsApp number health) are the original Analytics page's Campaigns and
// WhatsApp Health tabs, moved here unchanged in behaviour. They use their own endpoints and are not driven by the
// channel filter, because they are about WhatsApp templates and numbers specifically.

interface CampaignRow {
  id: string; name: string; status: string; templateName: string;
  totalRecipients: number; sentCount: number; deliveredCount: number; readCount: number;
  repliedCount: number; failedCount: number; clickCount: number;
  failureBreakdown: Array<{ category: string; label: string; count: number }>;
}
interface TemplatePerf {
  templateId: string; name: string; approvalStatus: string; sentCount: number; deliveryRate: number; readRate: number;
}
interface CampaignsResponse {
  from: string; to: string; campaigns: CampaignRow[]; templatePerformance: TemplatePerf[];
  meta: { total: number; limit: number; offset: number };
}

interface HealthResponse {
  numbers: Array<{ id: string; label: string; phoneNumberId: string; qualityRating: string | null; messagingLimitTier: string | null; qualitySyncedAt: string | null }>;
  numbersConfigured: boolean;
  optOuts: { last7Days: number; previous7Days: number; spike: boolean; blocked: number; optedOut: number };
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
      <BarChart3 size={28} className="text-gray-300" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
      <AlertCircle size={28} className="text-red-300" />
      <p className="text-sm">Failed to load this data.</p>
      <button onClick={onRetry} className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Retry</button>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-gray-100 rounded-xl animate-pulse', className)} />;
}

// ─── Campaigns tab ──────────────────────────────────────────────────────────────

function CampaignFunnel({ campaign }: { campaign: CampaignRow }) {
  const steps = [
    { label: 'Sent', value: campaign.sentCount, color: 'bg-blue-400' },
    { label: 'Delivered', value: campaign.deliveredCount, color: 'bg-teal-400' },
    { label: 'Read', value: campaign.readCount, color: 'bg-purple-400' },
    { label: 'Replied', value: campaign.repliedCount, color: 'bg-green-400' },
    { label: 'Clicked', value: campaign.clickCount, color: 'bg-indigo-400' },
  ];
  const total = campaign.totalRecipients || 1;
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{campaign.name}</p>
          <p className="text-xs text-gray-400">{campaign.templateName} · {campaign.status}</p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {steps.map((s) => (
          <div key={s.label} className="text-center">
            <div className="relative h-14 bg-gray-100 rounded-lg overflow-hidden flex items-end mb-1">
              <div className={cn('w-full', s.color)} style={{ height: `${Math.max(2, Math.round((s.value / total) * 100))}%` }} />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-800">{s.value}</span>
            </div>
            <p className="text-[10px] text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>
      {campaign.failureBreakdown.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {campaign.failureBreakdown.map((f) => (
            <span key={f.category} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
              {f.label}: {f.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CampaignsPanel({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<CampaignsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.campaigns(from, to);
      setData(res.data as CampaignsResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-96" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-4">Campaign Funnels ({data.meta.total})</h3>
        {data.campaigns.length === 0 ? <EmptyState message="No campaigns sent in this period" /> : (
          <div className="space-y-3">
            {data.campaigns.map((c) => <CampaignFunnel key={c.id} campaign={c} />)}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <h3 className="font-semibold text-gray-900 text-sm px-5 pt-5 mb-2">Template Performance</h3>
        {data.templatePerformance.length === 0 ? <div className="px-5 pb-5"><EmptyState message="No templates used yet" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Template</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Approval</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Sent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Delivery Rate</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Read Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.templatePerformance.map((t) => (
                  <tr key={t.templateId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                        t.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : t.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                        {t.approvalStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.sentCount}</td>
                    <td className="px-4 py-3 text-gray-600">{t.deliveryRate}%</td>
                    <td className="px-4 py-3 text-gray-600">{t.readRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Health tab ─────────────────────────────────────────────────────────────────

const QUALITY_STYLE: Record<string, string> = {
  GREEN: 'bg-emerald-100 text-emerald-700', YELLOW: 'bg-amber-100 text-amber-700', RED: 'bg-red-100 text-red-600',
};

export function HealthPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.health();
      setData(res.data as HealthResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-72" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-4">WhatsApp Number Quality</h3>
        {!data.numbersConfigured ? <EmptyState message="No WhatsApp numbers configured yet" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.numbers.map((n) => (
              <div key={n.id} className="border border-gray-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{n.label}</p>
                  <p className="text-xs text-gray-400">{n.messagingLimitTier ?? 'Tier unknown'}</p>
                </div>
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold', QUALITY_STYLE[n.qualityRating ?? ''] ?? 'bg-gray-100 text-gray-500')}>
                  {n.qualityRating ?? 'Unknown'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">Opt-outs &amp; Blocks (last 7 days)</h3>
          {data.optOuts.spike && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-600 font-semibold flex items-center gap-1">
              <ShieldAlert size={12} /> Spike detected
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-bold text-gray-900">{data.optOuts.last7Days}</p>
            <p className="text-xs text-gray-400">Last 7 days ({data.optOuts.blocked} blocked, {data.optOuts.optedOut} opted out)</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-400">{data.optOuts.previous7Days}</p>
            <p className="text-xs text-gray-400">Previous 7 days</p>
          </div>
        </div>
        {data.optOuts.spike && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            Opt-outs/blocks more than doubled compared to the previous week, worth checking recent campaigns or message frequency.
          </p>
        )}
      </div>
    </div>
  );
}

