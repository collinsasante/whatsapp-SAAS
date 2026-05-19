'use client';
import { useEffect, useState } from 'react';
import { Plus, Loader2, Check, X } from 'lucide-react';
import { adminSettingsApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Setting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(JSON.stringify(setting.value));
  const [desc, setDesc] = useState(setting.description ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      let parsed: unknown = val;
      try { parsed = JSON.parse(val); } catch { /* keep as string */ }
      await adminSettingsApi.upsert(setting.key, parsed, desc || undefined);
      toast.success('Setting saved');
      setEditing(false);
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 border-b border-slate-800/60 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-mono font-medium text-white">{setting.key}</p>
          </div>
          {editing ? (
            <div className="space-y-2 mt-2">
              <input
                type="text"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
                placeholder="Value (JSON or string)"
              />
              <input
                type="text"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-400 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
                placeholder="Description (optional)"
              />
            </div>
          ) : (
            <>
              <p className="text-sm font-mono text-slate-400 truncate">{JSON.stringify(setting.value)}</p>
              {setting.description && (
                <p className="text-xs text-slate-600 mt-0.5">{setting.description}</p>
              )}
            </>
          )}
          <p className="text-[11px] text-slate-700 mt-1.5">
            Updated {new Date(setting.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {setting.updatedBy ? ` · by ${setting.updatedBy}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#25D366] hover:bg-[#1aad57] text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Save
              </button>
              <button
                onClick={() => { setEditing(false); setVal(JSON.stringify(setting.value)); setDesc(setting.description ?? ''); }}
                className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs rounded-lg transition-colors"
              >
                <X size={11} /> Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-2.5 py-1.5 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-xs rounded-lg transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    adminSettingsApi.getAll()
      .then((r) => setSettings(r.data))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addSetting() {
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      let parsed: unknown = newVal;
      try { parsed = JSON.parse(newVal); } catch { /* keep as string */ }
      await adminSettingsApi.upsert(newKey.trim(), parsed, newDesc || undefined);
      toast.success('Setting created');
      setAdding(false);
      setNewKey('');
      setNewVal('');
      setNewDesc('');
      load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Platform-level key-value configuration.</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] hover:bg-[#1aad57] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> New setting
        </button>
      </div>

      {/* New setting form */}
      {adding && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 mb-4">
          <p className="text-sm font-semibold text-white mb-3">Add setting</p>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Key (e.g. max_agents_per_workspace)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm font-mono rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
            />
            <input
              type="text"
              placeholder='Value (JSON or string, e.g. 10 or "enabled")'
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm font-mono rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-400 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { setAdding(false); setNewKey(''); setNewVal(''); setNewDesc(''); }}
              className="flex-1 px-3 py-2 border border-slate-700 text-slate-400 hover:text-slate-200 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addSetting}
              disabled={!newKey.trim() || saving}
              className="flex-1 px-3 py-2 bg-[#25D366] hover:bg-[#1aad57] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-12">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
            Loading settings...
          </div>
        ) : settings.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">
            No settings yet. Add your first one above.
          </p>
        ) : (
          settings.map((s) => (
            <SettingRow key={s.id} setting={s} onSaved={load} />
          ))
        )}
      </div>
    </div>
  );
}
