'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Users, Send, CheckCheck, Eye, XCircle, Clock,
  Search, RefreshCw, Play, Pause, AlertCircle,
} from 'lucide-react';
import { campaignsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn, formatRelativeTime } from '@/lib/utils';

interface Campaign {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { name: string; language: string; category?: string };
}

interface Recipient {
  id: string;
  status: string;
  sentAt: string | null;
  errorMessage: string | null;
  contact: { id: string; name: string | null; phone: string; email: string | null };
}

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
  SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  RUNNING:   { label: 'Running',   cls: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  PAUSED:    { label: 'Paused',    cls: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400' },
  COMPLETED: { label: 'Completed', cls: 'bg-teal-100 text-teal-700',    dot: 'bg-teal-500' },
  FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-600',      dot: 'bg-red-500' },
};

const RECIPIENT_STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  PENDING:   { label: 'Pending',   cls: 'bg-gray-100 text-gray-500',    icon: Clock },
  SENT:      { label: 'Sent',      cls: 'bg-blue-100 text-blue-700',    icon: Send },
  DELIVERED: { label: 'Delivered', cls: 'bg-teal-100 text-teal-700',    icon: CheckCheck },
  READ:      { label: 'Read',      cls: 'bg-purple-100 text-purple-700', icon: Eye },
  FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-600',      icon: XCircle },
};

const STATUS_TABS = ['ALL', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'];

function pct(num: number, total: number) {
  return total > 0 ? Math.round((num / total) * 100) : 0;
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700', 'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700', 'bg-indigo-100 text-indigo-700',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.['id'] ?? '') as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [statusTab, setStatusTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const loadCampaign = useCallback(async () => {
    try {
      const res = await campaignsApi.get(id);
      setCampaign(res.data as Campaign);
    } catch { toast.error('Campaign not found'); router.push('/campaigns'); }
    finally { setLoading(false); }
  }, [id, router]);

  const loadRecipients = useCallback(async (p = 1, tab = statusTab, q = search) => {
    setRecipientsLoading(true);
    try {
      const res = await campaignsApi.getRecipients(id, {
        page: p, limit: LIMIT,
        ...(tab !== 'ALL' && { status: tab }),
        ...(q && { search: q }),
      });
      const d = res.data as { data: Recipient[]; meta: { total: number } };
      setRecipients(d.data ?? []);
      setRecipientTotal(d.meta?.total ?? 0);
    } finally { setRecipientsLoading(false); }
  }, [id, statusTab, search]);

  useEffect(() => { void loadCampaign(); }, [loadCampaign]);
  useEffect(() => {
    setPage(1);
    void loadRecipients(1, statusTab, search);
  }, [statusTab, search, loadRecipients]);

  // Auto-refresh every 15 s while campaign is running so the funnel stays live
  useEffect(() => {
    if (campaign?.status !== 'RUNNING') return;
    const timer = setInterval(() => {
      void loadCampaign();
      void loadRecipients(page, statusTab, search);
    }, 15_000);
    return () => clearInterval(timer);
  }, [campaign?.status, loadCampaign, loadRecipients, page, statusTab, search]);

  const handleTabChange = (tab: string) => { setStatusTab(tab); };

  const handlePageChange = (p: number) => {
    setPage(p);
    void loadRecipients(p, statusTab, search);
  };

  const launch = async () => {
    try { await campaignsApi.launch(id); void loadCampaign(); toast.success('Campaign launched!'); }
    catch { toast.error('Failed to launch'); }
  };
  const pause = async () => {
    try { await campaignsApi.pause(id); void loadCampaign(); toast.success('Campaign paused'); }
    catch { toast.error('Failed to pause'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!campaign) return null;

  const statusMeta = STATUS_META[campaign.status] ?? STATUS_META['DRAFT'];
  const totalPages = Math.ceil(recipientTotal / LIMIT);

  const funnelSteps = [
    { label: 'Total', value: campaign.totalRecipients, color: 'bg-gray-200', textColor: 'text-gray-700' },
    { label: 'Sent', value: campaign.sentCount, color: 'bg-blue-400', textColor: 'text-blue-700' },
    { label: 'Delivered', value: campaign.deliveredCount, color: 'bg-teal-400', textColor: 'text-teal-700' },
    { label: 'Read', value: campaign.readCount, color: 'bg-purple-400', textColor: 'text-purple-700' },
    { label: 'Failed', value: campaign.failedCount, color: 'bg-red-400', textColor: 'text-red-600' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => router.push('/campaigns')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={15} />Back
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-800">{campaign.name}</span>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
              <span className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', statusMeta.cls)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', statusMeta.dot, campaign.status === 'RUNNING' && 'animate-pulse')} />
                {statusMeta.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>Template: <span className="text-gray-600 font-medium">{campaign.template.name}</span> · {campaign.template.language}</span>
              {campaign.scheduledAt && <span>Scheduled: {new Date(campaign.scheduledAt).toLocaleString()}</span>}
              {campaign.startedAt && <span>Started: {new Date(campaign.startedAt).toLocaleString()}</span>}
              {campaign.completedAt && <span>Completed: {new Date(campaign.completedAt).toLocaleString()}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { void loadCampaign(); void loadRecipients(page); }}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
              <RefreshCw size={16} />
            </button>
            {(campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED') && (
              <button onClick={() => { void launch(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700">
                <Play size={14} />Launch
              </button>
            )}
            {campaign.status === 'RUNNING' && (
              <button onClick={() => { void pause(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm border border-orange-300 text-orange-600 rounded-xl hover:bg-orange-50">
                <Pause size={14} />Pause
              </button>
            )}
            {campaign.status === 'PAUSED' && (
              <button onClick={() => { void launch(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700">
                <Play size={14} />Resume
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Delivery funnel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Delivery Funnel</h2>
          <div className="grid grid-cols-5 gap-3">
            {funnelSteps.map(({ label, value, color, textColor }) => {
              const p = pct(value, campaign.totalRecipients || 1);
              return (
                <div key={label} className="text-center">
                  <div className="relative h-24 bg-gray-100 rounded-xl overflow-hidden mb-2 flex items-end">
                    <div
                      className={cn('w-full transition-all duration-700 rounded-xl', color)}
                      style={{ height: `${Math.max(p, 2)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-gray-800">
                      {value.toLocaleString()}
                    </span>
                  </div>
                  <p className={cn('text-xs font-semibold', textColor)}>{label}</p>
                  <p className="text-xs text-gray-400">{p}%</p>
                </div>
              );
            })}
          </div>
          {/* Progress bar */}
          <div className="mt-5 h-2 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="h-full bg-purple-400" style={{ width: `${pct(campaign.readCount, campaign.totalRecipients || 1)}%` }} />
            <div className="h-full bg-teal-400" style={{ width: `${pct(Math.max(0, campaign.deliveredCount - campaign.readCount), campaign.totalRecipients || 1)}%` }} />
            <div className="h-full bg-blue-400" style={{ width: `${pct(Math.max(0, campaign.sentCount - campaign.deliveredCount), campaign.totalRecipients || 1)}%` }} />
            <div className="h-full bg-red-400" style={{ width: `${pct(campaign.failedCount, campaign.totalRecipients || 1)}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-400" />Read</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-400" />Delivered</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400" />Sent</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" />Failed</span>
          </div>
        </div>

        {/* Recipients table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1 overflow-x-auto">
              {STATUS_TABS.map((tab) => (
                <button key={tab} onClick={() => handleTabChange(tab)}
                  className={cn('px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-colors font-medium',
                    statusTab === tab ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {tab === 'ALL' ? `All (${recipientTotal.toLocaleString()})` : tab.charAt(0) + tab.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <div className="relative flex-shrink-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search contacts…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500 w-52" />
            </div>
          </div>

          {recipientsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
            </div>
          ) : recipients.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users size={36} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No recipients found</p>
              {campaign.status === 'DRAFT' && (
                <p className="text-xs mt-1">Launch the campaign to start sending</p>
              )}
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sent</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recipients.map((r) => {
                    const rMeta = RECIPIENT_STATUS_META[r.status] ?? RECIPIENT_STATUS_META['PENDING'];
                    const StatusIcon = rMeta.icon;
                    const displayName = r.contact.name ?? r.contact.phone;
                    const color = avatarColor(displayName);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', color)}>
                              {initials(displayName)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{r.contact.name ?? <span className="text-gray-400 italic text-xs">No name</span>}</p>
                              <p className="text-xs text-gray-400 font-mono">{r.contact.phone}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', rMeta.cls)}>
                            <StatusIcon size={11} />
                            {rMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {r.sentAt ? formatRelativeTime(r.sentAt) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-red-500 max-w-48 truncate">
                          {r.errorMessage ? (
                            <span className="flex items-center gap-1" title={r.errorMessage}>
                              <AlertCircle size={11} className="flex-shrink-0" />
                              {r.errorMessage}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500">
                    {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, recipientTotal)} of {recipientTotal.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handlePageChange(page - 1)} disabled={page === 1}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      Prev
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                      return (
                        <button key={p} onClick={() => handlePageChange(p)}
                          className={cn('w-8 h-8 text-xs rounded-lg transition-colors',
                            p === page ? 'bg-teal-600 text-white' : 'hover:bg-gray-100 text-gray-600')}>
                          {p}
                        </button>
                      );
                    })}
                    <button onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
