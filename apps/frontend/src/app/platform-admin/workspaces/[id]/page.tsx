'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, Building2, Users, MessageSquare, Radio, CheckCircle2,
  XCircle, UserCheck, Ban, RefreshCw, Package, Phone, Globe, Mail,
  Save, Trash2, AlertCircle, Briefcase, Contact,
} from 'lucide-react';
import { adminWorkspacesApi } from '@/lib/admin-api';
import { useAdminStore } from '@/store/admin.store';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface WorkspaceDetail {
  id: string; name: string; slug: string; plan: string; isActive: boolean;
  billingEmail: string | null; country: string | null; industry: string | null;
  createdAt: string; updatedAt: string; recentMessages7d: number;
  settings: { businessName: string | null; businessEmail: string | null; businessPhone: string | null } | null;
  channels: { id: string; type: string; name: string; isActive: boolean; createdAt: string }[];
  workspaceMembers: {
    id: string; role: string; status: string;
    user: { id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null };
  }[];
  _count: { users: number; conversations: number; messages: number; contacts: number; campaigns: number; templates: number; channels: number };
}

const PLAN_BADGE: Record<string, string> = {
  FREE: 'bg-slate-100 text-slate-500 border-slate-200',
  free: 'bg-slate-100 text-slate-500 border-slate-200',
  PRO: 'bg-blue-50 text-blue-700 border-blue-200',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  BUSINESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  business: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ENTERPRISE: 'bg-purple-50 text-purple-700 border-purple-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
};

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  INSTAGRAM: 'bg-pink-50 text-pink-700 border-pink-100',
  FACEBOOK_MESSENGER: 'bg-blue-50 text-blue-700 border-blue-100',
  TELEGRAM: 'bg-sky-50 text-sky-700 border-sky-100',
  EMAIL: 'bg-orange-50 text-orange-700 border-orange-100',
  WEB_CHAT: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  AGENT: 'bg-teal-50 text-teal-700 border-teal-100',
  VIEWER: 'bg-slate-100 text-slate-500 border-slate-200',
};

function DeleteModal({ workspaceName, onConfirm, onCancel, loading }: {
  workspaceName: string; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  const [typed, setTyped] = useState('');
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center mb-4">
          <Trash2 size={17} className="text-red-600" />
        </div>
        <h2 className="text-slate-900 text-base font-bold mb-1">Delete Workspace</h2>
        <p className="text-slate-500 text-sm mb-5">
          This permanently deletes <strong className="text-slate-700">{workspaceName}</strong> and all its data. This action cannot be undone.
        </p>
        <label className="block text-xs text-slate-600 font-medium mb-1.5">
          Type <span className="font-mono font-bold text-red-600">{workspaceName}</span> to confirm
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={workspaceName}
          className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 mb-5 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={typed !== workspaceName || loading}
            className="flex-1 py-2.5 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Delete Workspace
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { admin } = useAdminStore();
  const { setAuth } = useAuthStore();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    adminWorkspacesApi.get(id)
      .then((r) => { setWorkspace(r.data as WorkspaceDetail); setNewPlan((r.data as WorkspaceDetail).plan); })
      .catch(() => toast.error('Failed to load workspace'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSuspend = async () => {
    if (!workspace || !window.confirm(`Suspend "${workspace.name}"?`)) return;
    setActionLoading('suspend');
    try {
      await adminWorkspacesApi.suspend(id);
      setWorkspace((w) => w ? { ...w, isActive: false } : w);
      toast.success('Workspace suspended');
    } catch { toast.error('Failed'); }
    finally { setActionLoading(null); }
  };

  const handleReactivate = async () => {
    setActionLoading('reactivate');
    try {
      await adminWorkspacesApi.reactivate(id);
      setWorkspace((w) => w ? { ...w, isActive: true } : w);
      toast.success('Workspace reactivated');
    } catch { toast.error('Failed'); }
    finally { setActionLoading(null); }
  };

  const handleImpersonate = async () => {
    if (!workspace || !window.confirm(`Enter "${workspace.name}" as impersonator?`)) return;
    setActionLoading('impersonate');
    try {
      const res = await adminWorkspacesApi.impersonate(id);
      const data = res.data as {
        accessToken: string;
        workspace: { id: string; name: string; slug: string; plan: string };
        user: { id: string; email: string; name: string; role: string; tenantId: string };
      };
      localStorage.setItem('pa_returning_to', `/platform-admin/workspaces/${id}`);
      localStorage.setItem('pa_impersonating', JSON.stringify({ workspaceId: id, workspaceName: data.workspace.name, adminName: admin?.name }));
      setAuth(
        { id: data.user.id, email: data.user.email, name: data.user.name, role: data.user.role as never, tenantId: data.user.tenantId },
        { id: data.workspace.id, name: data.workspace.name, slug: data.workspace.slug, onboardingCompleted: true },
        data.accessToken,
      );
      window.location.href = '/dashboard';
    } catch { toast.error('Failed to impersonate'); }
    finally { setActionLoading(null); }
  };

  const handlePlanChange = async () => {
    if (!workspace || newPlan === workspace.plan) return;
    setActionLoading('plan');
    try {
      await adminWorkspacesApi.updatePlan(id, newPlan);
      setWorkspace((w) => w ? { ...w, plan: newPlan } : w);
      toast.success(`Plan changed to ${newPlan}`);
    } catch { toast.error('Failed'); }
    finally { setActionLoading(null); }
  };

  const handleDelete = async () => {
    setActionLoading('delete');
    try {
      await adminWorkspacesApi.delete(id);
      toast.success('Workspace deleted');
      router.push('/platform-admin/workspaces');
    } catch { toast.error('Failed to delete'); }
    finally { setActionLoading(null); setShowDeleteModal(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center flex-1 h-full">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!workspace) return (
    <div className="p-7 flex items-center gap-2 text-red-500"><AlertCircle size={15} /> Workspace not found</div>
  );

  return (
    <div className="p-7 max-w-[1200px] mx-auto">
      {showDeleteModal && (
        <DeleteModal
          workspaceName={workspace.name}
          onConfirm={() => { void handleDelete(); }}
          onCancel={() => setShowDeleteModal(false)}
          loading={actionLoading === 'delete'}
        />
      )}

      <button
        onClick={() => router.push('/platform-admin/workspaces')}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-sm mb-5 transition-colors font-medium"
      >
        <ArrowLeft size={14} /> Back to workspaces
      </button>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 text-lg font-bold flex-shrink-0">
              {workspace.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-slate-900 text-xl font-bold">{workspace.name}</h1>
                <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wide', PLAN_BADGE[workspace.plan] ?? PLAN_BADGE.FREE)}>
                  {workspace.plan}
                </span>
                {workspace.isActive ? (
                  <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    <CheckCircle2 size={10} /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-600 text-xs font-semibold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                    <XCircle size={10} /> Suspended
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm mt-0.5">
                <span className="font-mono">{workspace.slug}</span>
                {' · '}Created {new Date(workspace.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => { void handleImpersonate(); }}
              disabled={!workspace.isActive || !!actionLoading}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold rounded-xl hover:bg-amber-100 disabled:opacity-30 transition-colors"
            >
              {actionLoading === 'impersonate' ? <div className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" /> : <UserCheck size={13} />}
              Impersonate
            </button>
            {workspace.isActive ? (
              <button
                onClick={() => { void handleSuspend(); }}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 text-red-700 border border-red-200 text-xs font-semibold rounded-xl hover:bg-red-100 disabled:opacity-30 transition-colors"
              >
                {actionLoading === 'suspend' ? <div className="w-3 h-3 border border-red-600 border-t-transparent rounded-full animate-spin" /> : <Ban size={13} />}
                Suspend
              </button>
            ) : (
              <button
                onClick={() => { void handleReactivate(); }}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold rounded-xl hover:bg-emerald-100 disabled:opacity-30 transition-colors"
              >
                {actionLoading === 'reactivate' ? <div className="w-3 h-3 border border-emerald-600 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={13} />}
                Reactivate
              </button>
            )}
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3.5 py-2 text-slate-500 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-30 transition-colors"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-5">
        {[
          { icon: Users, label: 'Members', value: workspace._count.users, color: 'text-indigo-500 bg-indigo-50 border-indigo-100' },
          { icon: MessageSquare, label: 'Conversations', value: workspace._count.conversations.toLocaleString(), color: 'text-teal-600 bg-teal-50 border-teal-100' },
          { icon: Package, label: 'Messages 7d', value: workspace.recentMessages7d.toLocaleString(), color: 'text-blue-500 bg-blue-50 border-blue-100' },
          { icon: Radio, label: 'Channels', value: workspace._count.channels, color: 'text-violet-500 bg-violet-50 border-violet-100' },
          { icon: Contact, label: 'Contacts', value: workspace._count.contacts.toLocaleString(), color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
        ].map(({ icon: Icon, label, value, color }) => {
          const [iconCls, bgCls, borderCls] = color.split(' ');
          return (
            <div key={label} className={cn('bg-white rounded-xl p-4 border text-center', borderCls)}>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2', bgCls)}>
                <Icon size={15} className={iconCls} />
              </div>
              <p className="text-slate-900 text-lg font-bold">{value}</p>
              <p className="text-slate-400 text-[10px] mt-0.5 font-medium">{label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Business info */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-slate-800 text-sm font-bold mb-4 flex items-center gap-2">
            <Briefcase size={14} className="text-slate-400" /> Business Info
          </h2>
          <div className="space-y-3.5">
            {workspace.settings?.businessEmail && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  <Mail size={12} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Business email</p>
                  <p className="text-slate-700 text-sm">{workspace.settings.businessEmail}</p>
                </div>
              </div>
            )}
            {workspace.billingEmail && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  <Mail size={12} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Billing email</p>
                  <p className="text-slate-700 text-sm">{workspace.billingEmail}</p>
                </div>
              </div>
            )}
            {workspace.settings?.businessPhone && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  <Phone size={12} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Phone</p>
                  <p className="text-slate-700 text-sm">{workspace.settings.businessPhone}</p>
                </div>
              </div>
            )}
            {workspace.country && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  <Globe size={12} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Country</p>
                  <p className="text-slate-700 text-sm">{workspace.country}</p>
                </div>
              </div>
            )}
            {workspace.industry && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  <Building2 size={12} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Industry</p>
                  <p className="text-slate-700 text-sm">{workspace.industry}</p>
                </div>
              </div>
            )}
            {!workspace.settings?.businessEmail && !workspace.billingEmail && !workspace.country && (
              <p className="text-slate-400 text-sm">No business info recorded</p>
            )}
          </div>
        </div>

        {/* Plan management */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-slate-800 text-sm font-bold mb-4">Plan Management</h2>
          <div className="mb-5 flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-slate-500 text-xs mb-0.5">Current plan</p>
              <span className={cn('text-sm font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wide', PLAN_BADGE[workspace.plan] ?? PLAN_BADGE.FREE)}>
                {workspace.plan}
              </span>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Last updated</p>
              <p className="text-slate-700 text-xs font-medium">{new Date(workspace.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>
          <label className="block text-xs text-slate-600 font-semibold uppercase tracking-wide mb-2">Change plan</label>
          <div className="flex gap-2">
            <select
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              onClick={() => { void handlePlanChange(); }}
              disabled={newPlan === workspace.plan || actionLoading === 'plan'}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl disabled:opacity-30 transition-colors"
            >
              {actionLoading === 'plan' ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Channels */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
        <h2 className="text-slate-800 text-sm font-bold mb-4">
          Channels <span className="text-slate-400 font-normal ml-1">({workspace.channels.length})</span>
        </h2>
        {workspace.channels.length === 0 ? (
          <div className="text-center py-8">
            <Radio size={20} className="text-slate-200 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No channels configured</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {workspace.channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 uppercase tracking-wide', CHANNEL_COLORS[ch.type] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                    {ch.type.replace(/_/g, ' ')}
                  </span>
                  <p className="text-slate-700 text-xs font-medium truncate">{ch.name}</p>
                </div>
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', ch.isActive ? 'bg-emerald-500' : 'bg-red-400')} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team members */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-slate-800 text-sm font-bold">
            Team Members <span className="text-slate-400 font-normal ml-1">({workspace.workspaceMembers.length})</span>
          </h2>
        </div>
        {workspace.workspaceMembers.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No members</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {workspace.workspaceMembers.slice(0, 10).map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 text-[10px] font-bold flex-shrink-0">
                    {m.user.name?.slice(0, 2).toUpperCase() ?? 'U'}
                  </div>
                  <div>
                    <p className="text-slate-700 text-sm font-medium">{m.user.name}</p>
                    <p className="text-slate-400 text-xs">{m.user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', ROLE_BADGE[m.role] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                    {m.role.toLowerCase()}
                  </span>
                  <span className={cn('w-2 h-2 rounded-full', m.user.isActive ? 'bg-emerald-500' : 'bg-slate-300')} />
                </div>
              </div>
            ))}
            {workspace.workspaceMembers.length > 10 && (
              <div className="px-5 py-3 text-slate-400 text-xs text-center border-t border-slate-100">
                +{workspace.workspaceMembers.length - 10} more members
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
