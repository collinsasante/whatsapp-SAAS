'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Play, Pause, BarChart3, X, AlertCircle, Search, RefreshCw,
  ChevronRight, Users, Send, CheckCheck, Eye,
  Filter, Upload, Tag, Layers,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { campaignsApi, templatesApi, segmentsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { offlineQueue } from '@/lib/offline-queue';
import { useOfflineStore } from '@/store/offline.store';

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

const CAMPAIGN_TYPE_META: Record<string, { label: string; cls: string }> = {
  MARKETING:      { label: 'Marketing',      cls: 'bg-orange-100 text-orange-700 border border-orange-200' },
  UTILITY:        { label: 'Utility',        cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
  AUTHENTICATION: { label: 'Authentication', cls: 'bg-purple-100 text-purple-700 border border-purple-200' },
};

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components: Array<{ type: string; text?: string; format?: string; buttons?: Array<{ text: string }> }>;
}

interface Segment {
  id: string;
  name: string;
  contactCount: number;
}

type AudienceMode = 'all' | 'segment' | 'label' | 'csv';

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
  SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  RUNNING:   { label: 'Running',   cls: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  PAUSED:    { label: 'Paused',    cls: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400' },
  COMPLETED: { label: 'Completed', cls: 'bg-teal-100 text-teal-700',    dot: 'bg-teal-500' },
  FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-600',      dot: 'bg-red-500' },
};

const FILTERS = ['All', 'Draft', 'Scheduled', 'Running', 'Paused', 'Completed', 'Failed'];

function extractVariables(components: Template['components']): string[] {
  const vars: string[] = [];
  for (const comp of components) {
    if (!comp.text) continue;
    const matches = comp.text.matchAll(/\{\{(\d+)\}\}/g);
    for (const m of matches) { if (!vars.includes(m[1])) vars.push(m[1]); }
  }
  return vars.sort((a, b) => parseInt(a) - parseInt(b));
}

function pct(num: number, total: number) {
  return total > 0 ? Math.round((num / total) * 100) : 0;
}

function DeliveryBar({ campaign }: { campaign: Campaign }) {
  const total = campaign.totalRecipients;
  if (!total) return <span className="text-xs text-gray-400">No recipients</span>;
  const sentPct = pct(campaign.sentCount, total);
  const delivPct = pct(campaign.deliveredCount, total);
  const readPct = pct(campaign.readCount, total);
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-teal-500 transition-all" style={{ width: `${readPct}%` }} />
        <div className="h-full bg-teal-300 transition-all" style={{ width: `${Math.max(0, delivPct - readPct)}%` }} />
        <div className="h-full bg-teal-100 transition-all" style={{ width: `${Math.max(0, sentPct - delivPct)}%` }} />
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span><span className="text-teal-600 font-medium">{campaign.readCount}</span> read</span>
        <span><span className="text-teal-500 font-medium">{campaign.deliveredCount}</span> delivered</span>
        <span><span className="text-gray-700 font-medium">{campaign.sentCount}</span> sent</span>
        {campaign.failedCount > 0 && <span><span className="text-red-500 font-medium">{campaign.failedCount}</span> failed</span>}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const isOnline = useNetworkStatus();
  const { setQueuedCounts } = useOfflineStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('all');
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '', templateId: '', labels: '', scheduledAt: '',
    templateVariables: {} as Record<string, string>,
    segmentId: '',
    csvPhones: [] as string[],
    csvFileName: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(1);

  const selectedTemplate = templates.find((t) => t.id === form.templateId) ?? null;
  const templateVars = selectedTemplate ? extractVariables(selectedTemplate.components) : [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [camRes, tplRes, segRes] = await Promise.all([
        campaignsApi.list({ limit: 100 }),
        templatesApi.list({ status: 'APPROVED', limit: 100 }),
        segmentsApi.list(),
      ]);
      setCampaigns((camRes.data as { data: Campaign[] }).data ?? []);
      setTotal((camRes.data as { meta: { total: number } }).meta?.total ?? 0);
      setTemplates((tplRes.data as { data: Template[] }).data ?? []);
      setSegments((segRes.data as Segment[]) ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Re-estimate recipient count whenever audience selection changes
  useEffect(() => {
    if (step !== 3) return;
    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const payload: { segmentId?: string; labels?: string[]; phones?: string[] } = {};
        if (audienceMode === 'segment' && form.segmentId) payload.segmentId = form.segmentId;
        else if (audienceMode === 'label' && form.labels) payload.labels = form.labels.split(',').map(l => l.trim()).filter(Boolean);
        else if (audienceMode === 'csv' && form.csvPhones.length) payload.phones = form.csvPhones;
        const res = await campaignsApi.estimateRecipients(payload);
        setEstimatedCount((res.data as { count: number }).count);
      } catch { setEstimatedCount(null); }
      finally { setEstimating(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [step, audienceMode, form.segmentId, form.labels, form.csvPhones]);

  const resetForm = () => {
    setForm({ name: '', templateId: '', labels: '', scheduledAt: '', templateVariables: {}, segmentId: '', csvPhones: [], csvFileName: '' });
    setErrors({});
    setStep(1);
    setAudienceMode('all');
    setEstimatedCount(null);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!form.name.trim()) e['name'] = 'Campaign name is required';
      if (!form.templateId) e['templateId'] = 'Please select a template';
    }
    if (step === 2) {
      for (const v of templateVars) {
        if (!form.templateVariables[v]?.trim()) e[`var_${v}`] = `Variable {{${v}}} is required`;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => { if (validate()) setStep((s) => s + 1); };

  const createCampaign = async () => {
    if (!validate()) return;
    setSubmitting(true);

    if (!isOnline) {
      try {
        const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await offlineQueue.enqueueDraft({
          id: draftId,
          audienceMode,
          form: {
            name: form.name,
            templateId: form.templateId,
            segmentId: form.segmentId || undefined,
            labels: form.labels || undefined,
            csvPhones: form.csvPhones.length ? form.csvPhones : undefined,
            scheduledAt: form.scheduledAt || undefined,
            templateVariables: Object.keys(form.templateVariables).length ? form.templateVariables : undefined,
          },
          createdAt: new Date().toISOString(),
        });
        const [msgs, drafts] = await Promise.all([offlineQueue.getAllMessages(), offlineQueue.getAllDrafts()]);
        setQueuedCounts(msgs.length, drafts.length);
        setShowCreate(false);
        resetForm();
        toast.success('Campaign saved — will be created when you reconnect.');
      } catch {
        toast.error('Failed to save campaign draft.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const audiencePayload: Record<string, unknown> = {};
      if (audienceMode === 'segment' && form.segmentId) audiencePayload['segmentId'] = form.segmentId;
      else if (audienceMode === 'label' && form.labels) audiencePayload['labels'] = form.labels.split(',').map(l => l.trim()).filter(Boolean);
      else if (audienceMode === 'csv' && form.csvPhones.length) audiencePayload['phones'] = form.csvPhones;

      await campaignsApi.create({
        name: form.name,
        templateId: form.templateId,
        ...audiencePayload,
        scheduledAt: form.scheduledAt || undefined,
        templateVariables: Object.keys(form.templateVariables).length ? form.templateVariables : undefined,
      });
      setShowCreate(false);
      resetForm();
      await load();
      toast.success('Campaign created!');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed'
        : 'Failed';
      toast.error(typeof msg === 'string' ? msg : 'Failed to create campaign');
    } finally { setSubmitting(false); }
  };

  const launch = async (id: string) => {
    try { await campaignsApi.launch(id); await load(); toast.success('Campaign launched!'); }
    catch { toast.error('Failed to launch'); }
  };
  const pause = async (id: string) => {
    if (pausingId) return;
    setPausingId(id);
    try { await campaignsApi.pause(id); await load(); toast.success('Campaign paused'); }
    catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400) { await load(); toast.error('Campaign is no longer running'); }
      else toast.error('Failed to pause');
    }
    finally { setPausingId(null); }
  };

  const filtered = campaigns.filter((c) => {
    const matchStatus = statusFilter === 'All' || c.status === statusFilter.toUpperCase();
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.template.name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  // Summary stats
  const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalDelivered = campaigns.reduce((s, c) => s + c.deliveredCount, 0);
  const totalRead = campaigns.reduce((s, c) => s + c.readCount, 0);
  const totalFailed = campaigns.reduce((s, c) => s + c.failedCount, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
            <p className="text-sm text-gray-500 hidden sm:block">Broadcast messages to your WhatsApp contacts</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { void load(); }} className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
              <RefreshCw size={16} />
            </button>
            <button onClick={() => { setShowCreate(true); resetForm(); }}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors">
              <Plus size={15} /><span className="hidden sm:inline">New Campaign</span><span className="sm:hidden">New</span>
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total Campaigns', value: total, icon: BarChart3, color: 'text-teal-600 bg-teal-50' },
            { label: 'Messages Sent', value: totalSent, icon: Send, color: 'text-blue-600 bg-blue-50' },
            { label: 'Delivered', value: totalDelivered, icon: CheckCheck, color: 'text-green-600 bg-green-50' },
            { label: 'Read', value: totalRead, icon: Eye, color: 'text-purple-600 bg-purple-50' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-4 flex items-center gap-3">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
                <Icon size={17} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-lg font-bold text-gray-900">{value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-0.5">
            <Filter size={13} className="text-gray-400 flex-shrink-0" />
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors flex-shrink-0', statusFilter === f ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100')}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center pt-16 text-gray-400">
            <BarChart3 size={48} className="mx-auto mb-3 opacity-20" />
            <p className="font-medium text-gray-500">No campaigns found</p>
            <p className="text-sm mt-1">Create your first broadcast campaign</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaign</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">Recipients</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Delivery</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
                  <th className="px-4 py-3 w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((campaign) => {
                  const meta = STATUS_META[campaign.status] ?? STATUS_META['DRAFT'];
                  return (
                    <tr key={campaign.id} className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/campaigns/${campaign.id}`)}>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-gray-900">{campaign.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{campaign.template.name} · {campaign.template.language}</p>
                        {campaign.scheduledAt && (
                          <p className="text-xs text-blue-600 mt-0.5">Scheduled: {new Date(campaign.scheduledAt).toLocaleString()}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {(() => {
                          const cat = campaign.template.category?.toUpperCase() ?? 'MARKETING';
                          const typeMeta = CAMPAIGN_TYPE_META[cat] ?? CAMPAIGN_TYPE_META['MARKETING'];
                          return (
                            <span className={cn('inline-flex items-center text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap', typeMeta.cls)}>
                              {typeMeta.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', meta.cls)}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot, campaign.status === 'RUNNING' && 'animate-pulse')} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Users size={13} className="text-gray-400" />
                          <span className="font-medium text-gray-900">{campaign.totalRecipients.toLocaleString()}</span>
                          <span className="text-gray-400 text-xs">contacts</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 min-w-48">
                        <DeliveryBar campaign={campaign} />
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-400">{formatRelativeTime(campaign.createdAt)}</td>
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {(campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED') && (
                            <button onClick={() => { void launch(campaign.id); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">
                              <Play size={11} />Launch
                            </button>
                          )}
                          {campaign.status === 'RUNNING' && (
                            <button onClick={() => { void pause(campaign.id); }}
                              disabled={pausingId === campaign.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors disabled:opacity-50">
                              <Pause size={11} />{pausingId === campaign.id ? 'Pausing…' : 'Pause'}
                            </button>
                          )}
                          {campaign.status === 'PAUSED' && (
                            <button onClick={() => { void launch(campaign.id); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">
                              <Play size={11} />Resume
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Campaign wizard modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setShowCreate(false); resetForm(); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Modal header with steps */}
            <div className="px-6 py-5 border-b border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">New Campaign</h2>
                <button onClick={() => { setShowCreate(false); resetForm(); }}><X size={18} className="text-gray-400" /></button>
              </div>
              <div className="flex items-center gap-2">
                {['Template', 'Variables', 'Audience & Schedule'].map((label, i) => (
                  <div key={label} className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                        step > i + 1 ? 'bg-teal-600 text-white' : step === i + 1 ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500')}>
                        {step > i + 1 ? '✓' : i + 1}
                      </div>
                      <span className={cn('text-xs font-medium', step === i + 1 ? 'text-teal-700' : 'text-gray-400')}>{label}</span>
                    </div>
                    {i < 2 && <div className={cn('flex-1 h-0.5 mx-1', step > i + 1 ? 'bg-teal-500' : 'bg-gray-200')} />}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Campaign Name *</label>
                    <input type="text" placeholder="e.g. Ramadan Sale 2025"
                      value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors((e2) => ({ ...e2, name: '' })); }}
                      className={cn('w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500', errors['name'] ? 'border-red-400' : 'border-gray-200')} />
                    {errors['name'] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{errors['name']}</p>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1.5 block">WhatsApp Template *</label>
                    <select value={form.templateId} onChange={(e) => { setForm((f) => ({ ...f, templateId: e.target.value, templateVariables: {} })); setErrors((e2) => ({ ...e2, templateId: '' })); }}
                      className={cn('w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white', errors['templateId'] ? 'border-red-400' : 'border-gray-200')}>
                      <option value="">Choose an approved template…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.language}</option>)}
                    </select>
                    {errors['templateId'] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{errors['templateId']}</p>}
                    {templates.length === 0 && <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 p-2 rounded-lg">No approved templates. Go to Templates page and sync from Meta first.</p>}
                  </div>
                  {/* Campaign type derived from template */}
                  {selectedTemplate && selectedTemplate.category && (
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Campaign Type</label>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const cat = selectedTemplate.category.toUpperCase();
                          const typeMeta = CAMPAIGN_TYPE_META[cat] ?? CAMPAIGN_TYPE_META['MARKETING'];
                          return (
                            <span className={cn('inline-flex items-center text-xs px-3 py-1.5 rounded-full font-semibold', typeMeta.cls)}>
                              {typeMeta.label}
                            </span>
                          );
                        })()}
                        <span className="text-xs text-gray-400">Determined by template category</span>
                      </div>
                    </div>
                  )}

                  {/* Template preview */}
                  {selectedTemplate && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Preview</p>
                      <div className="bg-white rounded-xl p-3 shadow-sm max-w-xs">
                        {selectedTemplate.components.map((comp, i) => (
                          <div key={i}>
                            {comp.type === 'HEADER' && comp.text && <p className="font-bold text-sm text-gray-900 mb-1">{comp.text}</p>}
                            {comp.type === 'BODY' && comp.text && <p className="text-sm text-gray-700">{comp.text}</p>}
                            {comp.type === 'FOOTER' && comp.text && <p className="text-xs text-gray-400 mt-1">{comp.text}</p>}
                            {comp.type === 'BUTTONS' && comp.buttons && (
                              <div className="mt-2 space-y-1">
                                {comp.buttons.map((btn, j) => (
                                  <div key={j} className="text-center py-1.5 border border-teal-300 rounded-lg text-xs text-teal-600 font-medium">{btn.text}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  {templateVars.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <CheckCheck size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">This template has no variables</p>
                    </div>
                  ) : templateVars.map((v) => (
                    <div key={v}>
                      <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                        Variable <code className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">{`{{${v}}}`}</code>
                      </label>
                      <input type="text" placeholder={`Value for {{${v}}}…`}
                        value={form.templateVariables[v] ?? ''}
                        onChange={(e) => { setForm((f) => ({ ...f, templateVariables: { ...f.templateVariables, [v]: e.target.value } })); setErrors((e2) => ({ ...e2, [`var_${v}`]: '' })); }}
                        className={cn('w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500', errors[`var_${v}`] ? 'border-red-400' : 'border-gray-200')} />
                      {errors[`var_${v}`] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{errors[`var_${v}`]}</p>}
                    </div>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  {/* Audience mode tabs */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-2 block">Select Audience</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        { mode: 'all' as AudienceMode, icon: Users, label: 'All Contacts' },
                        { mode: 'segment' as AudienceMode, icon: Layers, label: 'Segment' },
                        { mode: 'label' as AudienceMode, icon: Tag, label: 'By Label' },
                        { mode: 'csv' as AudienceMode, icon: Upload, label: 'CSV Upload' },
                      ]).map(({ mode, icon: Icon, label }) => (
                        <button key={mode} onClick={() => setAudienceMode(mode)}
                          className={cn('flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-colors',
                            audienceMode === mode
                              ? 'bg-teal-600 text-white border-teal-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300 hover:text-teal-600')}>
                          <Icon size={16} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Audience-specific inputs */}
                  {audienceMode === 'all' && (
                    <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3">
                      All opted-in, non-blocked contacts in your account will receive this campaign.
                    </p>
                  )}

                  {audienceMode === 'segment' && (
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Choose Segment</label>
                      {segments.length === 0 ? (
                        <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-3">
                          No segments yet. Create one in the Contacts page first.
                        </p>
                      ) : (
                        <select value={form.segmentId}
                          onChange={(e) => setForm(f => ({ ...f, segmentId: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                          <option value="">Select a segment…</option>
                          {segments.map(s => (
                            <option key={s.id} value={s.id}>{s.name} ({s.contactCount.toLocaleString()} contacts)</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {audienceMode === 'label' && (
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Labels</label>
                      <input type="text" placeholder="vip, premium, ghana"
                        value={form.labels} onChange={(e) => setForm(f => ({ ...f, labels: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      <p className="text-xs text-gray-400 mt-1">Comma-separated. Contacts matching any label are included.</p>
                    </div>
                  )}

                  {audienceMode === 'csv' && (
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Upload Phone List</label>
                      <input ref={csvInputRef} type="file" accept=".csv,.txt" className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const text = ev.target?.result as string;
                            const phones = text.split(/[\n,;]+/)
                              .map(p => p.trim().replace(/\s+/g, '').replace(/[^+\d]/g, ''))
                              .filter(p => p.length >= 7);
                            setForm(f => ({ ...f, csvPhones: phones, csvFileName: file.name }));
                          };
                          reader.readAsText(file);
                        }} />
                      {form.csvPhones.length > 0 ? (
                        <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl p-3">
                          <div>
                            <p className="text-sm font-semibold text-teal-800">{form.csvFileName}</p>
                            <p className="text-xs text-teal-600">{form.csvPhones.length.toLocaleString()} phone numbers found</p>
                          </div>
                          <button onClick={() => setForm(f => ({ ...f, csvPhones: [], csvFileName: '' }))}
                            className="text-teal-500 hover:text-teal-700 text-xs underline">Clear</button>
                        </div>
                      ) : (
                        <button onClick={() => csvInputRef.current?.click()}
                          className="w-full py-8 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-teal-300 hover:text-teal-500 transition-colors flex flex-col items-center gap-2">
                          <Upload size={20} />
                          <span>Click to upload CSV or TXT</span>
                          <span className="text-xs">One phone number per line, or comma-separated</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Live count */}
                  <div className={cn('flex items-center gap-3 rounded-xl p-3.5 border',
                    estimatedCount !== null ? 'bg-teal-50 border-teal-100' : 'bg-gray-50 border-gray-200')}>
                    <Users size={18} className={estimatedCount !== null ? 'text-teal-600' : 'text-gray-400'} />
                    <div>
                      {estimating ? (
                        <p className="text-sm text-gray-500">Estimating…</p>
                      ) : estimatedCount !== null ? (
                        <>
                          <p className="font-semibold text-teal-800 text-sm">{estimatedCount.toLocaleString()} recipients</p>
                          <p className="text-xs text-teal-600">Opted-in, non-blocked contacts matching this selection</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">Select audience to see recipient count</p>
                      )}
                    </div>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Schedule <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input type="datetime-local" value={form.scheduledAt} min={new Date().toISOString().slice(0, 16)}
                      onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    <p className="text-xs text-gray-400 mt-1">Leave blank to create as draft and launch manually.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex gap-2 pt-4 border-t border-gray-100">
              {step > 1 ? (
                <button onClick={() => setStep((s) => s - 1)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Back</button>
              ) : (
                <button onClick={() => { setShowCreate(false); resetForm(); }} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Cancel</button>
              )}
              {step < 3 ? (
                <button onClick={nextStep} className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium flex items-center justify-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              ) : (
                <button onClick={() => { void createCampaign(); }} disabled={submitting}
                  className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-60 font-medium">
                  {submitting ? 'Creating…' : 'Create Campaign'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
