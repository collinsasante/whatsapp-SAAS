'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Building2, Users, MessageSquare, Radio, CheckCircle, XCircle,
  LogIn, AlertTriangle, Trash2, Loader2,
} from 'lucide-react';
import { platformAdminApi, type Workspace } from '@/lib/platform-admin-api';
import { useAdminStore } from '@/store/admin.store';

const PLANS = ['FREE', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'];

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { admin } = useAdminStore();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');

  async function load() {
    try {
      const res = await platformAdminApi.getWorkspace(id);
      setWs(res.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [id]);

  async function handleSuspend() {
    const reason = prompt('Reason for suspension:');
    if (!reason || !ws) return;
    setActing('suspend');
    try { await platformAdminApi.suspendWorkspace(ws.id, reason); await load(); }
    finally { setActing(''); }
  }

  async function handleReactivate() {
    if (!ws) return;
    setActing('reactivate');
    try { await platformAdminApi.reactivateWorkspace(ws.id); await load(); }
    finally { setActing(''); }
  }

  async function handleChangePlan(plan: string) {
    if (!ws) return;
    setActing('plan');
    try { await platformAdminApi.updateWorkspacePlan(ws.id, plan); await load(); }
    finally { setActing(''); }
  }

  async function handleImpersonate() {
    if (!ws) return;
    setActing('impersonate');
    try {
      const res = await platformAdminApi.impersonateWorkspace(ws.id);
      const { accessToken, tenant } = res.data;
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('pa_impersonating', JSON.stringify({
        workspaceId: ws.id,
        workspaceName: ws.name,
        adminName: admin?.name ?? 'Platform Admin',
      }));
      localStorage.setItem('pa_returning_to', '/platform-admin/workspaces');
      window.location.href = '/inbox';
    } finally { setActing(''); }
  }

  async function handleDelete() {
    if (!ws) return;
    const confirmed = confirm(`Permanently delete "${ws.name}"? This cannot be undone.`);
    if (!confirmed) return;
    setActing('delete');
    try {
      await platformAdminApi.deleteWorkspace(ws.id);
      router.replace('/platform-admin/workspaces');
    } finally { setActing(''); }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <Loader2 size={24} className="animate-spin text-teal-400" />
      </div>
    );
  }

  if (!ws) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Building2 size={40} className="mx-auto mb-3 opacity-30" />
        <p>Workspace not found</p>
        <Link href="/platform-admin/workspaces" className="text-teal-400 hover:text-teal-300 text-sm mt-2 inline-block">
          ← Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <Link href="/platform-admin/workspaces" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-white text-sm transition-colors mb-4">
          <ArrowLeft size={14} /> All workspaces
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white">{ws.name}</h1>
              {ws.isActive ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  <CheckCircle size={11} /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                  <XCircle size={11} /> Suspended
                </span>
              )}
            </div>
            <p className="text-slate-500 text-sm font-mono">{ws.id.slice(0, 8)} · Created {new Date(ws.createdAt).toLocaleDateString()}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleImpersonate}
              disabled={!!acting}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              <LogIn size={14} /> Impersonate
            </button>
            {ws.isActive ? (
              <button onClick={handleSuspend} disabled={!!acting} className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                <AlertTriangle size={14} /> Suspend
              </button>
            ) : (
              <button onClick={handleReactivate} disabled={!!acting} className="flex items-center gap-1.5 px-3 py-2 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 text-teal-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                <CheckCircle size={14} /> Reactivate
              </button>
            )}
            <button onClick={handleDelete} disabled={!!acting} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          { icon: Users,         label: 'Users',         val: ws._count?.users ?? '—' },
          { icon: MessageSquare, label: 'Conversations', val: ws._count?.conversations ?? '—' },
          { icon: Radio,         label: 'Channels',      val: ws._count?.channels ?? '—' },
        ].map(({ icon: Icon, label, val }) => (
          <div key={label} className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Icon size={16} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{typeof val === 'number' ? val.toLocaleString() : val}</p>
              <p className="text-slate-500 text-xs">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Plan */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold text-sm mb-4">Subscription Plan</h2>
          <div className="flex flex-wrap gap-2">
            {PLANS.map(plan => (
              <button
                key={plan}
                onClick={() => handleChangePlan(plan)}
                disabled={!!acting || ws.plan === plan}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:cursor-default ${
                  ws.plan === plan
                    ? 'bg-teal-500/15 text-teal-300 border-teal-500/25'
                    : 'bg-white/4 text-slate-400 hover:text-white border-white/10 hover:border-white/20'
                }`}
              >
                {plan}
              </button>
            ))}
          </div>
          {acting === 'plan' && <p className="text-teal-400 text-xs mt-3 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Updating…</p>}
        </div>

        {/* Owner */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold text-sm mb-4">Owner</h2>
          {ws.owner ? (
            <div>
              <p className="text-white text-sm font-medium">{ws.owner.name}</p>
              <p className="text-slate-500 text-xs mt-0.5">{ws.owner.email}</p>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No owner assigned</p>
          )}

          {ws.suspendReason && (
            <div className="mt-4 pt-4 border-t border-white/8">
              <p className="text-xs text-slate-500 mb-1">Suspension reason</p>
              <p className="text-red-300 text-sm">{ws.suspendReason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
