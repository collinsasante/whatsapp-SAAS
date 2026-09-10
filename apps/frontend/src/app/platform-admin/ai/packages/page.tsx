'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type AiCreditPackageRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

const emptyForm = { slug: '', name: '', credits: '', bonusCredits: '0', priceGhs: '', priceUsd: '', displayOrder: '0' };

export default function AiCreditPackagesPage() {
  const [rows, setRows] = useState<AiCreditPackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AiCreditPackageRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.aiCreditPackages());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (row: AiCreditPackageRow) => {
    setEditing(row);
    setForm({
      slug: row.slug, name: row.name, credits: String(row.credits), bonusCredits: String(row.bonusCredits),
      priceGhs: row.priceGhs != null ? String(row.priceGhs) : '', priceUsd: row.priceUsd != null ? String(row.priceUsd) : '',
      displayOrder: String(row.displayOrder),
    });
  };

  const save = async () => {
    if (!await showConfirm(`${editing ? 'Save changes to' : 'Create'} this credit package?`, { subtext: 'This is customer-facing pricing.', danger: false })) return;
    setSaving(true);
    try {
      const data = {
        name: form.name, credits: Number(form.credits), bonusCredits: Number(form.bonusCredits),
        priceGhs: form.priceGhs ? Number(form.priceGhs) : undefined, priceUsd: form.priceUsd ? Number(form.priceUsd) : undefined,
        displayOrder: Number(form.displayOrder),
      };
      if (editing) await adminApi.updateAiCreditPackage(editing.id, data);
      else await adminApi.createAiCreditPackage({ ...data, slug: form.slug, isActive: true } as Omit<AiCreditPackageRow, 'id'>);
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

  const toggleActive = async (row: AiCreditPackageRow) => {
    if (!await showConfirm(`${row.isActive ? 'Deactivate' : 'Activate'} "${row.name}"?`, { danger: row.isActive })) return;
    try {
      await adminApi.updateAiCreditPackage(row.id, { isActive: !row.isActive });
      toast.success('Updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: DataTableColumn<AiCreditPackageRow>[] = [
    { key: 'name', header: 'Package', render: (r) => <div><div className="font-medium text-gray-900">{r.name}</div><div className="text-xs text-gray-400">{r.slug}</div></div> },
    { key: 'credits', header: 'Credits', render: (r) => `${r.credits.toLocaleString()}${r.bonusCredits ? ` +${r.bonusCredits}` : ''}` },
    { key: 'priceGhs', header: 'Price (GHS)', render: (r) => r.priceGhs != null ? `GHS ${r.priceGhs}` : '—' },
    { key: 'priceUsd', header: 'Price (USD)', render: (r) => r.priceUsd != null ? `$${r.priceUsd}` : '—' },
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
          <h1 className="text-2xl font-bold text-gray-900">Credit Packages</h1>
          <p className="text-gray-500 text-sm mt-1">Customer-facing AI credit purchase packs</p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditing(null); setForm(emptyForm); }}
          className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> New package
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {formOpen && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">{editing ? `Edit ${editing.name}` : 'New credit package'}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {!editing && <input placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />}
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="Credits" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="Bonus credits" value={form.bonusCredits} onChange={(e) => setForm({ ...form, bonusCredits: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" step="any" placeholder="Price GHS" value={form.priceGhs} onChange={(e) => setForm({ ...form, priceGhs: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" step="any" placeholder="Price USD" value={form.priceUsd} onChange={(e) => setForm({ ...form, priceUsd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="Display order" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
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
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No credit packages yet" />
      </div>
    </div>
  );
}
