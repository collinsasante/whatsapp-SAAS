'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Ban, CheckCircle, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { adminWorkspacesApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  billingEmail: string | null;
  country: string | null;
  industry: string | null;
  createdAt: string;
  recentMessages7d: number;
  channels: { id: string; type: string; name: string; isActive: boolean; createdAt: string }[];
  workspaceMembers: { user: { id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null } }[];
  _count: { users: number; conversations: number; messages: number; contacts: number; campaigns: number; templates: number };
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [newPlan, setNewPlan] = useState('');

  useEffect(() => {
    adminWorkspacesApi.get(id)
      .then((r) => setWs(r.data))
      .catch(() => toast.error('Failed to load workspace'))
      .finally(() => setLoading(false));
  }, [id]);

  async function act(action: string) {
    if (!ws) return;
    setActing(action);
    try {
      if (action === 'suspend') {
        await adminWorkspacesApi.suspend(ws.id);
        toast.success('Workspace suspended');
        setWs((prev) => prev ? { ...prev, isActive: false } : prev);
      } else if (action === 'reactivate') {
        await adminWorkspacesApi.reactivate(ws.id);
        toast.success('Workspace reactivated');
        setWs((prev) => prev ? { ...prev, isActive: true } : prev);
      } else if (action === 'delete') {
        if (!confirm(`Permanently delete "${ws.name}"? This cannot be undone.`)) return;
        await adminWorkspacesApi.delete(ws.id);
        toast.success('Workspace deleted');
        router.replace('/admin/workspaces');
      } else if (action === 'impersonate') {
        const res = await adminWorkspacesApi.impersonate(ws.id);
        const token = res.data.accessToken;
        window.open(`${window.location.origin}/auth/impersonate?token=${token}`, '_blank');
      } else if (action === 'plan' && newPlan) {
        await adminWorkspacesApi.updatePlan(ws.id, newPlan);
        toast.success(`Plan updated to ${newPlan}`);
        setWs((prev) => prev ? { ...prev, plan: newPlan } : prev);
        setShowPlanModal(false);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Action failed');
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-500 text-sm">
        <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
        Loading workspace...
      </div>
    );
  }

  if (!ws) return <div className="p-8 text-slate-500 text-sm">Workspace not found.</div>;

  return (
    <div className="p-8 max-w-4xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">{ws.name}</h1>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              ws.isActive ? 'bg-emerald-900/40 text-[#25D366]' : 'bg-amber-900/30 text-amber-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ws.isActive ? 'bg-[#25D366]' : 'bg-amber-400'}`} />
              {ws.isActive ? 'Active' : 'Suspended'}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-0.5">/{ws.slug} · {ws.plan} plan</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPlanModal(true)}
            className="px-3 py-1.5 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-sm rounded-lg transition-colors"
          >
            Change plan
          </button>
          {ws.isActive ? (
            <button
              onClick={() => act('suspend')}
              disabled={acting === 'suspend'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-900/40 border border-amber-700/40 text-amber-400 hover:bg-amber-900/60 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {acting === 'suspend' ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
              Suspend
            </button>
          ) : (
            <button
              onClick={() => act('reactivate')}
              disabled={acting === 'reactivate'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 border border-emerald-700/40 text-[#25D366] hover:bg-emerald-900/60 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {acting === 'reactivate' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
              Reactivate
            </button>
          )}
          <button
            onClick={() => act('impersonate')}
            disabled={acting === 'impersonate'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/40 border border-blue-700/40 text-blue-400 hover:bg-blue-900/60 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {acting === 'impersonate' ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
            Sign in as
          </button>
          <button
            onClick={() => act('delete')}
            disabled={acting === 'delete'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/30 border border-red-800/40 text-red-400 hover:bg-red-900/50 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {acting === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Members', value: ws._count.users },
          { label: 'Conversations', value: ws._count.conversations },
          { label: 'Messages', value: ws._count.messages },
          { label: '7-day msgs', value: ws.recentMessages7d },
          { label: 'Contacts', value: ws._count.contacts },
          { label: 'Campaigns', value: ws._count.campaigns },
        ].map((s) => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-white tabular-nums">
              {s.value >= 1000 ? `${(s.value / 1000).toFixed(1)}k` : s.value}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Details</p>
          <dl className="space-y-2.5">
            {[
              { label: 'Billing email', value: ws.billingEmail ?? '—' },
              { label: 'Country', value: ws.country ?? '—' },
              { label: 'Industry', value: ws.industry ?? '—' },
              { label: 'Created', value: new Date(ws.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
              { label: 'Templates', value: ws._count.templates },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-xs text-slate-300 font-medium">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Channels */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Channels ({ws.channels.length})
          </p>
          {ws.channels.length === 0 ? (
            <p className="text-slate-600 text-xs">No channels configured.</p>
          ) : (
            <ul className="space-y-2">
              {ws.channels.map((ch) => (
                <li key={ch.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-300 font-medium">{ch.name}</p>
                    <p className="text-[11px] text-slate-600">{ch.type}</p>
                  </div>
                  <span className={`text-[11px] font-medium ${ch.isActive ? 'text-[#25D366]' : 'text-slate-600'}`}>
                    {ch.isActive ? 'Active' : 'Inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mt-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Team members ({ws.workspaceMembers.length})
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left pb-2 text-slate-500 font-semibold">Name</th>
              <th className="text-left pb-2 text-slate-500 font-semibold">Email</th>
              <th className="text-left pb-2 text-slate-500 font-semibold">Role</th>
              <th className="text-left pb-2 text-slate-500 font-semibold">Last login</th>
              <th className="text-left pb-2 text-slate-500 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {ws.workspaceMembers.map(({ user }) => (
              <tr key={user.id}>
                <td className="py-2 text-slate-300 font-medium">{user.name}</td>
                <td className="py-2 text-slate-500">{user.email}</td>
                <td className="py-2 text-slate-500 capitalize">{user.role.toLowerCase()}</td>
                <td className="py-2 text-slate-600">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : 'Never'}
                </td>
                <td className="py-2">
                  <span className={`font-medium ${user.isActive ? 'text-[#25D366]' : 'text-amber-400'}`}>
                    {user.isActive ? 'Active' : 'Suspended'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Plan modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-base font-bold text-white mb-1">Change plan</h2>
            <p className="text-slate-500 text-sm mb-4">Current: <span className="text-white">{ws.plan}</span></p>
            <select
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500 mb-4"
            >
              <option value="">Select plan</option>
              {['starter', 'growth', 'pro', 'enterprise'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPlanModal(false)}
                className="flex-1 px-3 py-2 border border-slate-700 text-slate-400 text-sm rounded-lg hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => act('plan')}
                disabled={!newPlan || acting === 'plan'}
                className="flex-1 px-3 py-2 bg-[#25D366] hover:bg-[#1aad57] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {acting === 'plan' ? 'Saving...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
