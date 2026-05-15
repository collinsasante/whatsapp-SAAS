'use client';
import { useEffect, useState } from 'react';
import { Save, Plus, AlertCircle, CheckCircle2, Settings } from 'lucide-react';
import { adminSettingsApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface PlatformSetting {
  id: string; key: string; value: unknown; description: string | null; updatedAt: string; updatedBy: string | null;
}

const DEFAULT_SETTINGS = [
  { key: 'maintenance_mode', value: false, description: 'Put the platform in maintenance mode (blocks all workspace logins)' },
  { key: 'registration_enabled', value: true, description: 'Allow new workspace registrations' },
  { key: 'max_free_agents', value: 3, description: 'Maximum agents allowed on the free plan' },
  { key: 'max_free_contacts', value: 500, description: 'Maximum contacts allowed on the free plan' },
  { key: 'max_free_messages_per_day', value: 1000, description: 'Maximum messages per day on the free plan' },
  { key: 'ai_enabled', value: true, description: 'Enable AI features across the platform' },
  { key: 'upload_max_mb', value: 64, description: 'Maximum file upload size in MB' },
  { key: 'default_plan', value: 'free', description: 'Default plan assigned to new workspaces' },
  { key: 'support_email', value: '', description: 'Platform support email address' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    adminSettingsApi.getAll()
      .then((r) => {
        const existing = r.data as PlatformSetting[];
        setSettings(existing);
        const vals: Record<string, string> = {};
        existing.forEach((s) => { vals[s.key] = JSON.stringify(s.value); });
        setEditValues(vals);
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key: string, description?: string | null) => {
    const rawVal = editValues[key] ?? '';
    let parsed: unknown;
    try { parsed = JSON.parse(rawVal); }
    catch { parsed = rawVal; } // treat as string if not valid JSON

    setSaving(key);
    try {
      const res = await adminSettingsApi.upsert(key, parsed, description ?? undefined);
      const updated = res.data as PlatformSetting;
      setSettings((prev) => {
        const idx = prev.findIndex((s) => s.key === key);
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
        return [...prev, updated];
      });
      toast.success(`Setting "${key}" saved`);
    } catch { toast.error('Failed to save setting'); }
    finally { setSaving(null); }
  };

  const handleAddNew = async () => {
    if (!newKey.trim()) { toast.error('Key is required'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(newValue); }
    catch { parsed = newValue; }
    setSaving('__new__');
    try {
      const res = await adminSettingsApi.upsert(newKey.trim(), parsed, newDesc || undefined);
      const created = res.data as PlatformSetting;
      setSettings((prev) => [...prev.filter((s) => s.key !== newKey.trim()), created]);
      setEditValues((prev) => ({ ...prev, [newKey.trim()]: newValue }));
      setNewKey(''); setNewValue(''); setNewDesc('');
      toast.success(`Setting "${newKey.trim()}" created`);
    } catch { toast.error('Failed to create setting'); }
    finally { setSaving(null); }
  };

  // Merge stored + defaults
  const mergedSettings = [
    ...DEFAULT_SETTINGS.filter((d) => !settings.find((s) => s.key === d.key)),
    ...settings,
  ].sort((a, b) => a.key.localeCompare(b.key));

  if (loading) return (
    <div className="p-6 flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-xl font-bold">Platform Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Global configuration for the entire platform</p>
      </div>

      {/* Maintenance banner */}
      {(() => {
        const maintenanceSetting = settings.find((s) => s.key === 'maintenance_mode');
        if (maintenanceSetting?.value) {
          return (
            <div className="flex items-center gap-3 bg-amber-950/60 border border-amber-900 rounded-xl px-4 py-3 mb-5">
              <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
              <p className="text-amber-400 text-sm font-medium">Maintenance mode is ON — workspace logins are blocked</p>
            </div>
          );
        }
        return null;
      })()}

      {/* Settings list */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800 mb-5">
        {mergedSettings.map((setting) => {
          const key = setting.key;
          const storedSetting = settings.find((s) => s.key === key);
          const isDirty = storedSetting
            ? editValues[key] !== JSON.stringify(storedSetting.value)
            : (editValues[key] ?? '') !== '';
          const isBoolean = typeof (storedSetting?.value ?? (DEFAULT_SETTINGS.find((d) => d.key === key)?.value)) === 'boolean';

          return (
            <div key={key} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-rose-400 text-xs font-mono bg-rose-950/30 px-1.5 py-0.5 rounded">{key}</code>
                    {storedSetting ? (
                      <span className="text-emerald-400 text-[10px] flex items-center gap-0.5"><CheckCircle2 size={9} />Saved</span>
                    ) : (
                      <span className="text-gray-600 text-[10px]">Default</span>
                    )}
                    {storedSetting?.updatedAt && (
                      <span className="text-gray-700 text-[10px]">· {new Date(storedSetting.updatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  <p className="text-gray-600 text-xs mb-2">{storedSetting?.description ?? (DEFAULT_SETTINGS.find((d) => d.key === key)?.description ?? '')}</p>

                  {isBoolean ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const current = editValues[key];
                          const newVal = current === 'true' ? 'false' : 'true';
                          setEditValues((prev) => ({ ...prev, [key]: newVal }));
                        }}
                        className={`relative w-9 h-5 rounded-full transition-colors ${editValues[key] === 'true' ? 'bg-rose-600' : 'bg-gray-700'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${editValues[key] === 'true' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className="text-gray-400 text-xs">{editValues[key] === 'true' ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={editValues[key] ?? (storedSetting ? JSON.stringify(storedSetting.value) : JSON.stringify(DEFAULT_SETTINGS.find((d) => d.key === key)?.value ?? ''))}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 w-full max-w-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-600"
                    />
                  )}
                </div>

                <button
                  onClick={() => { void handleSave(key, storedSetting?.description ?? DEFAULT_SETTINGS.find((d) => d.key === key)?.description); }}
                  disabled={!isDirty || saving === key}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-30 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
                >
                  {saving === key ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add custom setting */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={13} className="text-gray-400" />
          <h2 className="text-gray-300 text-sm font-semibold">Add Custom Setting</h2>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-1">Key</label>
              <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="setting_key"
                className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-2 font-mono placeholder-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-600" />
            </div>
            <div className="flex-1">
              <label className="block text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-1">Value (JSON)</label>
              <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder='"value" or true or 42'
                className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-2 font-mono placeholder-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-600" />
            </div>
          </div>
          <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)"
            className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-2 placeholder-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-600" />
          <button onClick={() => { void handleAddNew(); }} disabled={!newKey.trim() || saving === '__new__'}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-30 text-white text-xs font-semibold rounded-lg transition-colors w-fit">
            {saving === '__new__' ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={11} />}
            Add Setting
          </button>
        </div>
      </div>
    </div>
  );
}
