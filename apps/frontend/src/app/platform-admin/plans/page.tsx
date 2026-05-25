'use client';
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, RefreshCw, AlertCircle } from 'lucide-react';
import { adminApi, type Plan } from '@/lib/admin-api';
import toast from 'react-hot-toast';

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
    </div>
  );
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.plans();
      setPlans(data);
      setEdits({});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const edit = (id: string, key: keyof Plan, val: string) => {
    const numFields = ['monthlyPrice', 'yearlyPrice', 'limMaxAgents', 'limMaxContacts', 'limMessagesPerMonth', 'limAiCreditsPerMonth', 'limMaxChannels', 'limMaxCampaigns', 'limStorageGb'];
    setEdits(e => ({
      ...e,
      [id]: { ...e[id], [key]: numFields.includes(key) ? parseFloat(val) || 0 : val },
    }));
  };

  const save = async (plan: Plan) => {
    const changes = edits[plan.id];
    if (!changes || Object.keys(changes).length === 0) return;
    setSaving(plan.id);
    try {
      await adminApi.updatePlan(plan.id, changes);
      toast.success(`${plan.name} updated`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const val = (plan: Plan, key: keyof Plan) =>
    edits[plan.id]?.[key] !== undefined ? String(edits[plan.id][key]) : String(plan[key]);

  const isDirty = (id: string) => edits[id] && Object.keys(edits[id]).length > 0;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plans</h1>
          <p className="text-gray-500 text-sm mt-1">Edit pricing and limits for each plan</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 mb-6 text-xs text-gray-400">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Changes take effect for new subscriptions. Existing subscriptions are not retroactively updated.
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-6 h-40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {plans.map(plan => (
            <div key={plan.id} className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                  <code className="text-xs text-gray-400">{plan.slug}</code>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(edits[plan.id]?.isActive !== undefined ? edits[plan.id].isActive : plan.isActive) as boolean}
                      onChange={e => edit(plan.id, 'isActive', String(e.target.checked))}
                      className="rounded text-teal-600"
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(edits[plan.id]?.isPublic !== undefined ? edits[plan.id].isPublic : plan.isPublic) as boolean}
                      onChange={e => edit(plan.id, 'isPublic', String(e.target.checked))}
                      className="rounded text-teal-600"
                    />
                    Public
                  </label>
                  <button
                    onClick={() => save(plan)}
                    disabled={!isDirty(plan.id) || saving === plan.id}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-40 transition-colors font-medium"
                  >
                    {saving === plan.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Monthly Price ($)" value={val(plan, 'monthlyPrice')} onChange={v => edit(plan.id, 'monthlyPrice', v)} type="number" />
                <Field label="Yearly Price ($)" value={val(plan, 'yearlyPrice')} onChange={v => edit(plan.id, 'yearlyPrice', v)} type="number" />
                <Field label="Max Agents" value={val(plan, 'limMaxAgents')} onChange={v => edit(plan.id, 'limMaxAgents', v)} type="number" />
                <Field label="Max Contacts" value={val(plan, 'limMaxContacts')} onChange={v => edit(plan.id, 'limMaxContacts', v)} type="number" />
                <Field label="Messages / Month" value={val(plan, 'limMessagesPerMonth')} onChange={v => edit(plan.id, 'limMessagesPerMonth', v)} type="number" />
                <Field label="AI Credits / Month" value={val(plan, 'limAiCreditsPerMonth')} onChange={v => edit(plan.id, 'limAiCreditsPerMonth', v)} type="number" />
                <Field label="Max Channels" value={val(plan, 'limMaxChannels')} onChange={v => edit(plan.id, 'limMaxChannels', v)} type="number" />
                <Field label="Max Campaigns" value={val(plan, 'limMaxCampaigns')} onChange={v => edit(plan.id, 'limMaxCampaigns', v)} type="number" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
