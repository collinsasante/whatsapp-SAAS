'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type FeatureFlagRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

export default function FeatureFlagsPage() {
  const [rows, setRows] = useState<FeatureFlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.featureFlags());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setSaving(true);
    try {
      await adminApi.createFeatureFlag(form);
      toast.success('Flag created');
      setCreating(false);
      setForm({ key: '', name: '', description: '' });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (row: FeatureFlagRow) => {
    if (!await showConfirm(`${row.enabled ? 'Disable' : 'Enable'} "${row.name}"?`, { subtext: 'This changes behavior for every tenant matching its rollout rules.', danger: row.enabled })) return;
    try {
      await adminApi.updateFeatureFlag(row.id, { enabled: !row.enabled });
      toast.success('Updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const setRolloutPct = async (row: FeatureFlagRow, pct: number) => {
    try {
      await adminApi.updateFeatureFlag(row.id, { rolloutPct: pct, rolloutType: 'percentage' });
      toast.success('Rollout updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: DataTableColumn<FeatureFlagRow>[] = [
    { key: 'name', header: 'Flag', render: (r) => <div><div className="font-medium text-gray-900">{r.name}</div><div className="text-xs text-gray-400 font-mono">{r.key}</div></div> },
    { key: 'enabled', header: 'Enabled', render: (r) => (
      <button onClick={() => toggleEnabled(r)}>
        <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'On' : 'Off'}</Badge>
      </button>
    ) },
    { key: 'rollout', header: 'Rollout %', render: (r) => (
      <input
        type="number" min={0} max={100} defaultValue={r.rolloutPct}
        onBlur={(e) => { const v = Number(e.target.value); if (v !== r.rolloutPct) void setRolloutPct(r, v); }}
        className="w-16 text-sm border border-gray-200 rounded px-2 py-1"
      />
    ) },
    { key: 'rollouts', header: 'Per-tenant overrides', render: (r) => r._count.rollouts },
    { key: 'category', header: 'Category', render: (r) => r.category ?? '—' },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
          <p className="text-gray-500 text-sm mt-1">Platform-wide and per-tenant feature rollout control</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> New flag
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {creating && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">New feature flag</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input placeholder="Key (e.g. new_ai_pipeline)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={create} disabled={saving || !form.key || !form.name} className="bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setCreating(false)} className="text-gray-500 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No feature flags yet" />
      </div>
    </div>
  );
}
