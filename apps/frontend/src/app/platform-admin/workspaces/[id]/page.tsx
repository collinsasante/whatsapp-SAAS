'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Building2, Users, Radio, DollarSign, ScrollText, Megaphone,
  CheckCircle2, XCircle, Loader2, AlertTriangle, CreditCard,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { adminApi, type WorkspaceDetail, type Plan } from '@/lib/admin-api';

const LIFECYCLE_LABELS: Record<string, string> = {
  signed_up: 'Signed up',
  whatsapp_connected: 'WhatsApp connected',
  template_approved: 'Template approved',
  first_engagement: 'First engagement',
  team_invited: 'Team invited',
  converted_paid: 'Converted to paid',
  active_last_7_days: 'Active & paying',
};

function healthColor(score: number) {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 40) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showSetPlan, setShowSetPlan] = useState(false);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState('');
  const [settingPlan, setSettingPlan] = useState(false);

  const id = params?.id ?? '';

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await adminApi.getWorkspace(id);
      setData(res);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { adminApi.plans().then(setPlans).catch(() => {}); }, []);

  const toggleActive = async () => {
    if (!data) return;
    setActing(true);
    try {
      if (data.isActive) {
        await adminApi.suspendWorkspace(data.id);
        toast.success(`${data.name} suspended`);
      } else {
        await adminApi.activateWorkspace(data.id);
        toast.success(`${data.name} activated`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(false);
    }
  };

  const confirmSetPlan = async () => {
    if (!data || !selectedPlanSlug) return;
    setSettingPlan(true);
    try {
      const res = await adminApi.forceSubscription(data.id, selectedPlanSlug);
      toast.success(`${data.name} upgraded to ${res.plan}`);
      setShowSetPlan(false);
      setSelectedPlanSlug('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSettingPlan(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>;
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <button onClick={() => router.push('/platform-admin/workspaces')} className="text-sm text-gray-500 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" />Back to workspaces
        </button>
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error || 'Workspace not found'}</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <button onClick={() => router.push('/platform-admin/workspaces')} className="text-sm text-gray-500 flex items-center gap-1 mb-4 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" />Back to workspaces
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{data.name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${healthColor(data.healthScore)}`} title="Health score">
              {data.healthScore}
            </span>
            {data.churnRisk && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" />Churn risk
              </span>
            )}
            {!data.isActive && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Suspended</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {data.billingEmail ?? '—'}{data.country ? ` · ${data.country}` : ''} · Signed up {new Date(data.createdAt).toLocaleDateString()}
          </p>
          <p className="text-xs text-teal-600 font-medium mt-1">{LIFECYCLE_LABELS[data.lifecycleStage] ?? data.lifecycleStage}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowSetPlan(true); setSelectedPlanSlug(plans.find((p) => p.name === data.subscription?.plan.name)?.slug ?? ''); }}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />Set Plan
          </button>
          <button
            onClick={() => { void toggleActive(); }}
            disabled={acting}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
              data.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
            }`}
          >
            {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : data.isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {data.isActive ? 'Suspend' : 'Activate'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column: profile + health + whatsapp */}
        <div className="space-y-5">
          <Panel title="Profile" icon={Building2}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Plan</dt><dd className="font-medium text-gray-800">{data.subscription?.plan.name ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Status</dt><dd className="font-medium text-gray-800">{data.subscription?.status ?? 'No subscription'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Billing cycle</dt><dd className="font-medium text-gray-800">{data.subscription?.cycle ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Team size</dt><dd className="font-medium text-gray-800">{data._count.users}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Contacts</dt><dd className="font-medium text-gray-800">{data._count.contacts}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Conversations (all-time)</dt><dd className="font-medium text-gray-800">{data._count.conversations}</dd></div>
            </dl>
          </Panel>

          <Panel title="Health score breakdown" icon={Users}>
            <div className="space-y-2 text-xs">
              {([
                ['Login activity', data.healthBreakdown.loginActivity, 25],
                ['Message activity', data.healthBreakdown.messageActivity, 25],
                ['Broadcast activity', data.healthBreakdown.broadcastActivity, 15],
                ['Team size', data.healthBreakdown.teamSize, 15],
                ['Payment status', data.healthBreakdown.paymentStatus, 20],
              ] as const).map(([label, val, max]) => (
                <div key={label}>
                  <div className="flex justify-between text-gray-500 mb-0.5"><span>{label}</span><span>{val}/{max}</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(val / max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="WhatsApp numbers" icon={Radio}>
            {data.whatsappNumbers.length === 0 ? (
              <p className="text-xs text-gray-400">No active WhatsApp number</p>
            ) : (
              <div className="space-y-2">
                {data.whatsappNumbers.map((n) => (
                  <div key={n.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-700">{n.label ?? n.phoneNumberId}</span>
                    <span className={n.qualityRating === 'GREEN' ? 'text-emerald-600' : n.qualityRating === 'YELLOW' ? 'text-amber-600' : n.qualityRating === 'RED' ? 'text-red-600' : 'text-gray-400'}>
                      {n.qualityRating ?? 'Unknown'}{n.messagingLimitTier ? ` · ${n.messagingLimitTier}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Middle + right columns: usage charts, campaigns, payments, audit log */}
        <div className="lg:col-span-2 space-y-5">
          <Panel title="Message volume (90 days)" icon={Megaphone}>
            {data.usage.messageTrend.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">No message data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data.usage.messageTrend}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="sent" name="Sent" stroke="#0d9488" strokeWidth={1.5} fill="url(#sentGrad)" dot={false} />
                  <Area type="monotone" dataKey="received" name="Received" stroke="#6366f1" strokeWidth={1.5} fill="url(#recvGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Conversation volume (90 days)" icon={Users}>
            {data.usage.conversationTrend.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">No conversation data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={data.usage.conversationTrend}>
                  <defs>
                    <linearGradient id="openGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="opened" name="Opened" stroke="#f59e0b" strokeWidth={1.5} fill="url(#openGrad)" dot={false} />
                  <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" strokeWidth={1.5} fill="none" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Recent campaigns" icon={Megaphone}>
            {data.recentCampaigns.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No campaigns sent yet</p>
            ) : (
              <div className="space-y-1.5">
                {data.recentCampaigns.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-700">{c.name}</span>
                    <span className="text-gray-400">{c.status} · {c.sentCount}/{c.totalRecipients}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Payment history (all providers)" icon={DollarSign}>
            {data.payments.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No payments yet</p>
            ) : (
              <div className="space-y-1.5">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <span className={`font-medium ${p.status === 'SUCCEEDED' ? 'text-emerald-600' : p.status === 'FAILED' ? 'text-red-500' : 'text-gray-600'}`}>{p.status}</span>
                      <span className="text-gray-400 ml-2">{p.gateway}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-gray-700 font-medium">{p.currency} {p.amount.toFixed(2)}</div>
                      <div className="text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Admin activity on this workspace" icon={ScrollText}>
            {data.auditLog.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No admin actions taken yet</p>
            ) : (
              <div className="space-y-1.5">
                {data.auditLog.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-700">{a.action}</span>
                    <span className="text-gray-400">{a.admin?.name ?? 'Unknown admin'} · {new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {showSetPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">Set Plan</h2>
              <p className="text-sm text-gray-500 mt-0.5">Workspace: <span className="font-medium text-gray-700">{data.name}</span></p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Select Plan</label>
              <select
                value={selectedPlanSlug}
                onChange={(e) => setSelectedPlanSlug(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">— choose a plan —</option>
                {plans.map((p) => <option key={p.id} value={p.slug}>{p.name} ({p.slug})</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowSetPlan(false); setSelectedPlanSlug(''); }} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => { void confirmSetPlan(); }} disabled={!selectedPlanSlug || settingPlan} className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {settingPlan && <Loader2 className="w-4 h-4 animate-spin" />}Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
