'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type AiPricingConfigRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

const emptyForm = { provider: '', modelKey: '', inputCostPerMillionUsd: '', outputCostPerMillionUsd: '', creditsPerUsd: '' };

export default function AiPricingPage() {
  const [rows, setRows] = useState<AiPricingConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AiPricingConfigRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.aiPricing());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (row: AiPricingConfigRow) => {
    setEditing(row);
    setForm({
      provider: row.provider, modelKey: row.modelKey,
      inputCostPerMillionUsd: String(row.inputCostPerMillionUsd), outputCostPerMillionUsd: String(row.outputCostPerMillionUsd),
      creditsPerUsd: String(row.creditsPerUsd),
    });
  };

  const save = async () => {
    if (!await showConfirm('Save this AI pricing change?', { subtext: 'This affects how AI usage is billed platform-wide going forward.', danger: false })) return;
    setSaving(true);
    try {
      if (editing) {
        await adminApi.updateAiPricing(editing.id, {
          inputCostPerMillionUsd: Number(form.inputCostPerMillionUsd),
          outputCostPerMillionUsd: Number(form.outputCostPerMillionUsd),
          creditsPerUsd: Number(form.creditsPerUsd),
        });
      } else {
        await adminApi.createAiPricing({
          provider: form.provider, modelKey: form.modelKey,
          inputCostPerMillionUsd: Number(form.inputCostPerMillionUsd),
          outputCostPerMillionUsd: Number(form.outputCostPerMillionUsd),
          creditsPerUsd: Number(form.creditsPerUsd),
        });
      }
      toast.success('Saved');
      setEditing(null);
      setCreating(false);
      setForm(emptyForm);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: AiPricingConfigRow) => {
    if (!await showConfirm(`${row.isActive ? 'Deactivate' : 'Activate'} ${row.provider}/${row.modelKey} pricing?`, { danger: row.isActive })) return;
    try {
      await adminApi.updateAiPricing(row.id, { isActive: !row.isActive });
      toast.success('Updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: DataTableColumn<AiPricingConfigRow>[] = [
    { key: 'provider', header: 'Provider', render: (r) => <span className="font-medium text-gray-900">{r.provider}</span> },
    { key: 'modelKey', header: 'Model', render: (r) => r.modelKey },
    { key: 'input', header: 'Input $/M', render: (r) => `$${r.inputCostPerMillionUsd}` },
    { key: 'output', header: 'Output $/M', render: (r) => `$${r.outputCostPerMillionUsd}` },
    { key: 'creditsPerUsd', header: 'Credits/$', render: (r) => r.creditsPerUsd },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex gap-2">
          <button onClick={() => startEdit(r)} className="text-teal-600 hover:underline text-xs font-medium">Edit</button>
          <button onClick={() => toggleActive(r)} className="text-gray-500 hover:underline text-xs font-medium">{r.isActive ? 'Deactivate' : 'Activate'}</button>
        </div>
      ),
    },
  ];

  const formOpen = editing || creating;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Pricing</h1>
          <p className="text-gray-500 text-sm mt-1">Provider/model cost and credit-conversion configuration</p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditing(null); setForm(emptyForm); }}
          className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> New pricing config
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {formOpen && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">{editing ? `Edit ${editing.provider}/${editing.modelKey}` : 'New pricing config'}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {!editing && (
              <>
                <input placeholder="Provider (e.g. deepseek)" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Model key" value={form.modelKey} onChange={(e) => setForm({ ...form, modelKey: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </>
            )}
            <input type="number" step="any" placeholder="Input $/M tokens" value={form.inputCostPerMillionUsd} onChange={(e) => setForm({ ...form, inputCostPerMillionUsd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" step="any" placeholder="Output $/M tokens" value={form.outputCostPerMillionUsd} onChange={(e) => setForm({ ...form, outputCostPerMillionUsd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" step="any" placeholder="Credits per $1" value={form.creditsPerUsd} onChange={(e) => setForm({ ...form, creditsPerUsd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={saving} className="bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(null); setCreating(false); }} className="text-gray-500 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No pricing configs yet" />
      </div>
    </div>
  );
}
