'use client';
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, AlertCircle, Plus, X } from 'lucide-react';
import { adminApi, type Plan } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

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

const BLANK_NEW_PLAN = {
  slug: '', name: '', description: '',
  monthlyPrice: 0, yearlyPrice: 0,
  isActive: true, isPublic: true, sortOrder: 0,
  limMaxAgents: 3, limMaxContacts: 5000,
  limMessagesPerMonth: 10000, limAiCreditsPerMonth: 100,
  limMaxChannels: 1, limMaxCampaigns: 5,
};

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPlan, setNewPlan] = useState({ ...BLANK_NEW_PLAN });

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await adminApi.plans();
      setPlans(data);
      setEdits({});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const { secondsAgo, refresh } = useAutoRefresh(load);

  const edit = (id: string, key: keyof Plan, val: string) => {
    const numFields = ['monthlyPrice', 'yearlyPrice', 'limMaxAgents', 'limMaxContacts', 'limMessagesPerMonth', 'limAiCreditsPerMonth', 'limMaxChannels', 'limMaxCampaigns', 'limStorageGb', 'sortOrder'];
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

  const createPlan = async () => {
    if (!newPlan.slug.trim() || !newPlan.name.trim()) {
      toast.error('Slug and name are required');
      return;
    }
    setCreating(true);
    try {
      await adminApi.createPlan(newPlan);
      toast.success(`Plan "${newPlan.name}" created`);
      setShowCreate(false);
      setNewPlan({ ...BLANK_NEW_PLAN });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
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
        <div className="flex items-center gap-2">
          <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" /> New Plan
          </button>
        </div>
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

      {/* Create Plan Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">New Plan</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Slug (unique)" value={newPlan.slug} onChange={v => setNewPlan(p => ({ ...p, slug: v.toLowerCase().replace(/\s+/g, '-') }))} />
                <Field label="Name" value={newPlan.name} onChange={v => setNewPlan(p => ({ ...p, name: v }))} />
              </div>
              <Field label="Description (optional)" value={newPlan.description} onChange={v => setNewPlan(p => ({ ...p, description: v }))} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Monthly Price ($)" value={newPlan.monthlyPrice} onChange={v => setNewPlan(p => ({ ...p, monthlyPrice: parseFloat(v) || 0 }))} type="number" />
                <Field label="Yearly Price ($)" value={newPlan.yearlyPrice} onChange={v => setNewPlan(p => ({ ...p, yearlyPrice: parseFloat(v) || 0 }))} type="number" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Max Agents" value={newPlan.limMaxAgents} onChange={v => setNewPlan(p => ({ ...p, limMaxAgents: parseInt(v) || 0 }))} type="number" />
                <Field label="Max Contacts" value={newPlan.limMaxContacts} onChange={v => setNewPlan(p => ({ ...p, limMaxContacts: parseInt(v) || 0 }))} type="number" />
                <Field label="Messages / Month" value={newPlan.limMessagesPerMonth} onChange={v => setNewPlan(p => ({ ...p, limMessagesPerMonth: parseInt(v) || 0 }))} type="number" />
                <Field label="AI Credits / Month" value={newPlan.limAiCreditsPerMonth} onChange={v => setNewPlan(p => ({ ...p, limAiCreditsPerMonth: parseInt(v) || 0 }))} type="number" />
                <Field label="Max Channels" value={newPlan.limMaxChannels} onChange={v => setNewPlan(p => ({ ...p, limMaxChannels: parseInt(v) || 0 }))} type="number" />
                <Field label="Max Campaigns" value={newPlan.limMaxCampaigns} onChange={v => setNewPlan(p => ({ ...p, limMaxCampaigns: parseInt(v) || 0 }))} type="number" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={newPlan.isActive} onChange={e => setNewPlan(p => ({ ...p, isActive: e.target.checked }))} className="rounded text-teal-600" />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={newPlan.isPublic} onChange={e => setNewPlan(p => ({ ...p, isPublic: e.target.checked }))} className="rounded text-teal-600" />
                  Public (visible on pricing page)
                </label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={createPlan}
                disabled={creating}
                className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
