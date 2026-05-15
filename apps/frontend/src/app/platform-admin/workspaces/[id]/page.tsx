'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, Building2, Users, MessageSquare, Radio, CheckCircle2,
  XCircle, UserCheck, Ban, RefreshCw, Package, Phone, Globe, Mail,
  Edit2, Trash2, AlertCircle,
} from 'lucide-react';
import { adminWorkspacesApi } from '@/lib/admin-api';
import { useAdminStore } from '@/store/admin.store';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface WorkspaceDetail {
  id: string; name: string; slug: string; plan: string; isActive: boolean;
  billingEmail: string | null; country: string | null; industry: string | null;
  createdAt: string; updatedAt: string;
  recentMessages7d: number;
  settings: { businessName: string | null; businessEmail: string | null; businessPhone: string | null } | null;
  channels: { id: string; type: string; name: string; isActive: boolean; createdAt: string }[];
  workspaceMembers: {
    id: string; role: string; status: string;
    user: { id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null };
  }[];
  _count: { users: number; conversations: number; messages: number; contacts: number; campaigns: number; templates: number; channels: number };
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-800 text-gray-400',
  starter: 'bg-blue-950 text-blue-400',
  pro: 'bg-violet-950 text-violet-400',
  enterprise: 'bg-amber-950 text-amber-400',
};

const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: '💬', INSTAGRAM: '📸', FACEBOOK_MESSENGER: '💙', TELEGRAM: '✈️', EMAIL: '📧', TIKTOK: '🎵',
};

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { admin } = useAdminStore();
  const { setAuth } = useAuthStore();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState('');

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
      localStorage.setItem('pa_impersonating', JSON.stringify({
        workspaceId: id, workspaceName: data.workspace.name, adminName: admin?.name,
      }));
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
    if (!workspace) return;
    const confirm1 = window.confirm(`DELETE workspace "${workspace.name}"?\n\nThis will permanently delete ALL data including contacts, conversations, and messages. This CANNOT be undone.`);
    if (!confirm1) return;
    const confirm2 = window.prompt(`Type the workspace name to confirm deletion:`) === workspace.name;
    if (!confirm2) { toast.error('Name did not match — deletion cancelled'); return; }
    setActionLoading('delete');
    try {
      await adminWorkspacesApi.delete(id);
      toast.success('Workspace deleted');
      router.push('/platform-admin/workspaces');
    } catch { toast.error('Failed to delete'); }
    finally { setActionLoading(null); }
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!workspace) return (
    <div className="p-6 text-gray-500 flex items-center gap-2">
      <AlertCircle size={14} /> Workspace not found
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back */}
      <button onClick={() => router.push('/platform-admin/workspaces')}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-sm mb-5 transition-colors">
        <ArrowLeft size={14} /> Back to workspaces
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-800 border border-gray-700 rounded-xl flex items-center justify-center">
            <Building2 size={16} className="text-gray-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-white text-lg font-bold">{workspace.name}</h1>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', PLAN_COLORS[workspace.plan] ?? PLAN_COLORS.free)}>
                {workspace.plan}
              </span>
              {workspace.isActive ? (
                <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 size={10} /> Active</span>
              ) : (
                <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle size={10} /> Suspended</span>
              )}
            </div>
            <p className="text-gray-500 text-xs">{workspace.slug} · Created {new Date(workspace.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void handleImpersonate(); }}
            disabled={!workspace.isActive || !!actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/60 text-amber-400 border border-amber-900/50 text-xs font-semibold rounded-lg hover:bg-amber-900/40 disabled:opacity-30 transition-colors"
          >
            {actionLoading === 'impersonate' ? <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" /> : <UserCheck size={12} />}
            Impersonate
          </button>
          {workspace.isActive ? (
            <button onClick={() => { void handleSuspend(); }} disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/60 text-red-400 border border-red-900/50 text-xs font-semibold rounded-lg hover:bg-red-900/40 disabled:opacity-30 transition-colors">
              {actionLoading === 'suspend' ? <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" /> : <Ban size={12} />}
              Suspend
            </button>
          ) : (
            <button onClick={() => { void handleReactivate(); }} disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/60 text-emerald-400 border border-emerald-900/50 text-xs font-semibold rounded-lg hover:bg-emerald-900/40 disabled:opacity-30 transition-colors">
              {actionLoading === 'reactivate' ? <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={12} />}
              Reactivate
            </button>
          )}
          <button onClick={() => { void handleDelete(); }} disabled={!!actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-gray-400 border border-gray-700 text-xs font-semibold rounded-lg hover:bg-red-950/40 hover:text-red-400 disabled:opacity-30 transition-colors">
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { icon: Users, label: 'Members', value: workspace._count.users },
          { icon: MessageSquare, label: 'Conversations', value: workspace._count.conversations.toLocaleString() },
          { icon: Package, label: 'Messages', value: workspace._count.messages.toLocaleString() },
          { icon: Radio, label: 'Channels', value: workspace._count.channels },
          { icon: Users, label: 'Contacts', value: workspace._count.contacts.toLocaleString() },
          { icon: Package, label: 'Last 7d msgs', value: workspace.recentMessages7d.toLocaleString() },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <Icon size={14} className="text-gray-500 mx-auto mb-1.5" />
            <p className="text-white text-base font-bold">{value}</p>
            <p className="text-gray-600 text-[10px]">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Info */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Workspace Info</h2>
            <div className="space-y-2.5">
              {workspace.settings?.businessEmail && (
                <div className="flex items-center gap-2"><Mail size={12} className="text-gray-600" /><span className="text-gray-300 text-xs">{workspace.settings.businessEmail}</span></div>
              )}
              {workspace.billingEmail && (
                <div className="flex items-center gap-2"><Mail size={12} className="text-gray-600" /><span className="text-gray-300 text-xs">{workspace.billingEmail} <span className="text-gray-600">(billing)</span></span></div>
              )}
              {workspace.settings?.businessPhone && (
                <div className="flex items-center gap-2"><Phone size={12} className="text-gray-600" /><span className="text-gray-300 text-xs">{workspace.settings.businessPhone}</span></div>
              )}
              {workspace.country && (
                <div className="flex items-center gap-2"><Globe size={12} className="text-gray-600" /><span className="text-gray-300 text-xs">{workspace.country}</span></div>
              )}
              {workspace.industry && (
                <div className="flex items-center gap-2"><Building2 size={12} className="text-gray-600" /><span className="text-gray-300 text-xs">{workspace.industry}</span></div>
              )}
            </div>
          </div>

          {/* Plan management */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Change Plan</h2>
            <div className="flex gap-2">
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-rose-600"
              >
                {['free', 'starter', 'pro', 'enterprise'].map((p) => (
                  <option key={p} value={p} className="capitalize">{p}</option>
                ))}
              </select>
              <button
                onClick={() => { void handlePlanChange(); }}
                disabled={newPlan === workspace.plan || actionLoading === 'plan'}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-30 transition-colors"
              >
                {actionLoading === 'plan' ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Edit2 size={11} />}
              </button>
            </div>
          </div>
        </div>

        {/* Channels */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Channels ({workspace.channels.length})</h2>
            {workspace.channels.length === 0 ? (
              <p className="text-gray-600 text-xs">No channels configured</p>
            ) : (
              <div className="space-y-2">
                {workspace.channels.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{CHANNEL_ICONS[ch.type] ?? '📡'}</span>
                      <div>
                        <p className="text-gray-300 text-xs font-medium">{ch.name}</p>
                        <p className="text-gray-600 text-[10px]">{ch.type}</p>
                      </div>
                    </div>
                    {ch.isActive ? (
                      <span className="text-emerald-400 text-[10px] flex items-center gap-1"><CheckCircle2 size={9} />Active</span>
                    ) : (
                      <span className="text-red-400 text-[10px] flex items-center gap-1"><XCircle size={9} />Inactive</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Members */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Team Members ({workspace.workspaceMembers.length})</h2>
            {workspace.workspaceMembers.length === 0 ? (
              <p className="text-gray-600 text-xs">No members</p>
            ) : (
              <div className="space-y-2">
                {workspace.workspaceMembers.slice(0, 10).map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 text-[9px] font-bold">
                        {m.user.name?.slice(0, 2).toUpperCase() ?? 'U'}
                      </div>
                      <div>
                        <p className="text-gray-300 text-xs">{m.user.name}</p>
                        <p className="text-gray-600 text-[10px]">{m.user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 text-[10px] capitalize">{m.role.toLowerCase()}</span>
                      {m.user.isActive ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))}
                {workspace.workspaceMembers.length > 10 && (
                  <p className="text-gray-600 text-[10px] text-center pt-1">+{workspace.workspaceMembers.length - 10} more members</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
