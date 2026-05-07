'use client';
import { useEffect, useState } from 'react';
import { Plus, Play, Pause, BarChart, X, AlertCircle } from 'lucide-react';
import { campaignsApi, templatesApi } from '@/lib/api';
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
  createdAt: string;
  template: { name: string; language: string };
}

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  components: Array<{ type: string; text?: string; format?: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  PAUSED: 'bg-orange-100 text-orange-700',
  FAILED: 'bg-red-100 text-red-700',
};

function extractVariables(components: Template['components']): string[] {
  const vars: string[] = [];
  for (const comp of components) {
    if (!comp.text) continue;
    const matches = comp.text.matchAll(/\{\{(\d+)\}\}/g);
    for (const m of matches) {
      if (!vars.includes(m[1])) vars.push(m[1]);
    }
  }
  return vars.sort((a, b) => parseInt(a) - parseInt(b));
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const PAGE_SIZE = 20;
  const [form, setForm] = useState({
    name: '',
    templateId: '',
    labels: '',
    scheduledAt: '',
    templateVariables: {} as Record<string, string>,
  });

  const selectedTemplate = templates.find((t) => t.id === form.templateId) ?? null;
  const templateVars = selectedTemplate ? extractVariables(selectedTemplate.components) : [];

  const load = async (reset = true) => {
    if (reset) { setLoading(true); setPage(1); } else setLoadingMore(true);
    const currentPage = reset ? 1 : page + 1;
    try {
      const [camRes, tplRes] = await Promise.all([
        campaignsApi.list({ page: currentPage, limit: PAGE_SIZE }),
        reset ? templatesApi.list({ status: 'APPROVED', limit: 100 }) : Promise.resolve(null),
      ]);
      const camData = camRes.data as { data: Campaign[]; meta: { total: number } };
      setCampaigns((prev) => reset ? camData.data : [...prev, ...camData.data]);
      setTotal(camData.meta?.total ?? 0);
      if (!reset) setPage(currentPage);
      if (reset && tplRes) setTemplates((tplRes.data as { data: Template[] }).data);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e['name'] = 'Campaign name is required';
    if (!form.templateId) e['templateId'] = 'Please select a template';
    for (const v of templateVars) {
      if (!form.templateVariables[v]?.trim()) e[`var_${v}`] = `Variable {{${v}}} is required`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const createCampaign = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await campaignsApi.create({
        name: form.name,
        templateId: form.templateId,
        labels: form.labels ? form.labels.split(',').map((l) => l.trim()).filter(Boolean) : undefined,
        scheduledAt: form.scheduledAt || undefined,
        templateVariables: Object.keys(form.templateVariables).length ? form.templateVariables : undefined,
      });
      setShowCreate(false);
      resetForm();
      await load();
      toast.success('Campaign created');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed'
        : 'Failed';
      toast.error(typeof msg === 'string' ? msg : 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', templateId: '', labels: '', scheduledAt: '', templateVariables: {} });
    setErrors({});
  };

  const launch = async (id: string) => {
    try {
      await campaignsApi.launch(id);
      await load();
      toast.success('Campaign launched!');
    } catch { toast.error('Failed to launch'); }
  };

  const pause = async (id: string) => {
    try {
      await campaignsApi.pause(id);
      await load();
      toast.success('Campaign paused');
    } catch { toast.error('Failed to pause'); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Campaigns</h1>
            <p className="text-sm text-gray-500">Broadcast messages to your contacts</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            New Campaign
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
        ) : campaigns.length === 0 ? (
          <div className="text-center pt-16 text-gray-400">
            <BarChart size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No campaigns yet</p>
            <p className="text-sm">Create your first broadcast campaign</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
                    <p className="text-sm text-gray-500">Template: {campaign.template.name} ({campaign.template.language})</p>
                    {campaign.scheduledAt && (
                      <p className="text-xs text-blue-600 mt-0.5">Scheduled: {new Date(campaign.scheduledAt).toLocaleString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-600')}>
                      {campaign.status}
                    </span>
                    {(campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED') && (
                      <button
                        onClick={() => { void launch(campaign.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <Play size={14} />
                        Launch
                      </button>
                    )}
                    {campaign.status === 'RUNNING' && (
                      <button
                        onClick={() => { void pause(campaign.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 transition-colors"
                      >
                        <Pause size={14} />
                        Pause
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-3 text-center">
                  {[
                    { label: 'Total', value: campaign.totalRecipients, color: 'text-gray-900' },
                    { label: 'Sent', value: campaign.sentCount, color: 'text-blue-600' },
                    { label: 'Delivered', value: campaign.deliveredCount, color: 'text-green-600' },
                    { label: 'Read', value: campaign.readCount, color: 'text-purple-600' },
                    { label: 'Failed', value: campaign.failedCount, color: 'text-red-600' },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gray-50 rounded-lg py-2">
                      <p className={cn('text-lg font-semibold', stat.color)}>{stat.value}</p>
                      <p className="text-xs text-gray-500">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">Created {formatRelativeTime(campaign.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
        {campaigns.length < total && !loading && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => { void load(false); }}
              disabled={loadingMore}
              className="px-5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : `Load more (${campaigns.length} of ${total})`}
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">New Campaign</h2>
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. Summer Sale Blast"
                  value={form.name}
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors((e2) => ({ ...e2, name: '' })); }}
                  className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500', errors['name'] ? 'border-red-400' : 'border-gray-200')}
                />
                {errors['name'] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} />{errors['name']}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template <span className="text-red-500">*</span></label>
                <select
                  value={form.templateId}
                  onChange={(e) => { setForm((f) => ({ ...f, templateId: e.target.value, templateVariables: {} })); setErrors((e2) => ({ ...e2, templateId: '' })); }}
                  className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500', errors['templateId'] ? 'border-red-400' : 'border-gray-200')}
                >
                  <option value="">Select approved template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                  ))}
                </select>
                {errors['templateId'] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} />{errors['templateId']}</p>}
                {templates.length === 0 && <p className="text-xs text-amber-600 mt-1">No approved templates found. Sync templates in the Templates page first.</p>}
              </div>

              {templateVars.length > 0 && (
                <div className="border border-blue-100 bg-blue-50 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Template Variables</p>
                  {templateVars.map((v) => (
                    <div key={v}>
                      <label className="block text-xs text-gray-600 mb-1">Variable <code className="bg-blue-100 px-1 rounded">{`{{${v}}}`}</code></label>
                      <input
                        type="text"
                        placeholder={`Value for {{${v}}}...`}
                        value={form.templateVariables[v] ?? ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, templateVariables: { ...f.templateVariables, [v]: e.target.value } }));
                          setErrors((e2) => ({ ...e2, [`var_${v}`]: '' }));
                        }}
                        className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white', errors[`var_${v}`] ? 'border-red-400' : 'border-gray-200')}
                      />
                      {errors[`var_${v}`] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} />{errors[`var_${v}`]}</p>}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Labels <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  placeholder="vip, premium (blank = all contacts)"
                  value={form.labels}
                  onChange={(e) => setForm((f) => ({ ...f, labels: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule For <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex gap-2 px-6 pb-6">
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => { void createCampaign(); }}
                disabled={submitting}
                className="flex-1 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
              >
                {submitting ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
