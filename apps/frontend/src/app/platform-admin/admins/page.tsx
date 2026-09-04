'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type PlatformAdminRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge, type BadgeTone } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

const ROLES = ['SUPER_ADMIN', 'SUPPORT', 'VIEWER'] as const;
const ROLE_TONES: Record<string, BadgeTone> = { SUPER_ADMIN: 'danger', SUPPORT: 'info', VIEWER: 'neutral' };

function getCurrentAdminId(): string | null {
  try {
    const token = localStorage.getItem('admin_token');
    if (!token) return null;
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))?.sub ?? null;
  } catch {
    return null;
  }
}

export default function AdminsPage() {
  const [rows, setRows] = useState<PlatformAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'VIEWER' as typeof ROLES[number] });
  const [saving, setSaving] = useState(false);
  const currentAdminId = getCurrentAdminId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.listAdmins());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const invite = async () => {
    setSaving(true);
    try {
      await adminApi.inviteAdmin(form.email, form.name, form.role);
      toast.success('Invite sent');
      setInviting(false);
      setForm({ email: '', name: '', role: 'VIEWER' });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (row: PlatformAdminRow, role: typeof ROLES[number]) => {
    if (role === row.role) return;
    if (!await showConfirm(`Change ${row.name}'s role to ${role}?`, { subtext: 'This changes what this admin can do platform-wide.', danger: role === 'SUPER_ADMIN' })) return;
    try {
      await adminApi.updateAdminRole(row.id, role);
      toast.success('Role updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: DataTableColumn<PlatformAdminRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <div><div className="font-medium text-gray-900">{r.name}</div><div className="text-xs text-gray-400">{r.email}</div></div> },
    {
      key: 'role', header: 'Role', render: (r) => r.id === currentAdminId ? (
        <Badge tone={ROLE_TONES[r.role]}>{r.role} (you)</Badge>
      ) : (
        <select value={r.role} onChange={(e) => changeRole(r, e.target.value as typeof ROLES[number])} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      ),
    },
    { key: 'lastLoginAt', header: 'Last login', render: (r) => r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : 'Never' },
    { key: 'createdAt', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Users</h1>
          <p className="text-gray-500 text-sm mt-1">Platform-admin accounts and roles</p>
        </div>
        <button
          onClick={() => setInviting(true)}
          className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700"
        >
          <UserPlus className="w-4 h-4" /> Invite admin
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {inviting && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Invite a new admin</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof ROLES[number] })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={invite} disabled={saving || !form.email || !form.name} className="bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'Sending…' : 'Send invite'}
            </button>
            <button onClick={() => setInviting(false)} className="text-gray-500 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No admins found" />
      </div>
    </div>
  );
}
