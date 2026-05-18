'use client';
import { useEffect, useState } from 'react';
import { Save, Plus, AlertCircle, CheckCircle2, Lock, Sliders, Cpu, Puzzle } from 'lucide-react';
import { adminSettingsApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlatformSetting {
  id: string; key: string; value: unknown; description: string | null; updatedAt: string; updatedBy: string | null;
}

interface SettingDef {
  key: string; label: string; description: string;
  type: 'boolean' | 'number' | 'text' | 'select'; options?: string[]; section: string;
}

const SETTING_DEFS: SettingDef[] = [
  { key: 'registration_enabled', label: 'New Registrations', description: 'Allow new workspace registrations on the platform', type: 'boolean', section: 'Access & Registration' },
  { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Blocks all workspace logins platform-wide', type: 'boolean', section: 'Access & Registration' },
  { key: 'default_plan', label: 'Default Plan', description: 'Plan assigned to newly registered workspaces', type: 'select', options: ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'], section: 'Access & Registration' },
  { key: 'support_email', label: 'Support Email', description: 'Platform support email shown to workspace users', type: 'text', section: 'Access & Registration' },
  { key: 'max_free_agents', label: 'Free Plan Agent Limit', description: 'Maximum agents allowed on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'max_free_contacts', label: 'Free Plan Contact Limit', description: 'Maximum contacts allowed on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'max_free_messages_per_day', label: 'Free Plan Daily Messages', description: 'Maximum messages per day on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'upload_max_mb', label: 'Max Upload Size (MB)', description: 'Maximum file upload size in megabytes', type: 'number', section: 'Limits & Quotas' },
  { key: 'ai_enabled', label: 'AI Features', description: 'Enable or disable AI features across the entire platform', type: 'boolean', section: 'Features' },
];

const SECTION_META: Record<string, { icon: React.ElementType; description: string }> = {
  'Access & Registration': { icon: Lock, description: 'Control who can access and sign up on the platform' },
  'Limits & Quotas':       { icon: Sliders, description: 'Usage limits and quotas for free-tier workspaces' },
  'Features':              { icon: Cpu, description: 'Toggle platform-wide features on or off' },
};

const DEFAULT_VALUES: Record<string, unknown> = {
  maintenance_mode: false, registration_enabled: true,
  max_free_agents: 3, max_free_contacts: 500,
  max_free_messages_per_day: 1000, ai_enabled: true,
  upload_max_mb: 64, default_plan: 'FREE', support_email: '',
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative w-10 h-[22px] rounded-full transition-colors flex-shrink-0', checked ? 'bg-indigo-600' : 'bg-slate-200')}
    >
      <span className={cn('absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform', checked ? 'translate-x-[20px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    adminSettingsApi.getAll()
      .then((r) => {
        const existing = r.data as PlatformSetting[];
        setSettings(existing);
        const vals: Record<string, unknown> = {};
        existing.forEach((s) => { vals[s.key] = s.value; });
        setEditValues(vals);
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key: string, description?: string | null) => {
    const rawVal = editValues[key] ?? DEFAULT_VALUES[key] ?? '';
    setSaving(key);
    try {
      const res = await adminSettingsApi.upsert(key, rawVal, description ?? undefined);
      const updated = res.data as PlatformSetting;
      setSettings((prev) => {
        const idx = prev.findIndex((s) => s.key === key);
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
        return [...prev, updated];
      });
      toast.success(`"${key}" saved`);
    } catch { toast.error('Failed to save'); }
    finally { setSaving(null); }
  };

  const handleAddNew = async () => {
    if (!newKey.trim()) { toast.error('Key is required'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(newValue); } catch { parsed = newValue; }
    setSaving('__new__');
    try {
      const res = await adminSettingsApi.upsert(newKey.trim(), parsed, newDesc || undefined);
      const created = res.data as PlatformSetting;
      setSettings((prev) => [...prev.filter((s) => s.key !== newKey.trim()), created]);
      setEditValues((prev) => ({ ...prev, [newKey.trim()]: parsed }));
      setNewKey(''); setNewValue(''); setNewDesc('');
      toast.success(`"${newKey.trim()}" created`);
    } catch { toast.error('Failed to create setting'); }
    finally { setSaving(null); }
  };

  const getValue = (key: string) => key in editValues ? editValues[key] : DEFAULT_VALUES[key];
  const getStored = (key: string) => settings.find((s) => s.key === key);
  const isDirty = (def: SettingDef) => {
    const stored = getStored(def.key);
    const currentVal = getValue(def.key);
    const storedVal = stored?.value ?? DEFAULT_VALUES[def.key];
    return JSON.stringify(currentVal) !== JSON.stringify(storedVal);
  };

  const knownKeys = new Set(SETTING_DEFS.map((d) => d.key));
  const customSettings = settings.filter((s) => !knownKeys.has(s.key));
  const maintenanceOn = getValue('maintenance_mode') === true;

  if (loading) return (
    <div className="flex items-center justify-center flex-1 h-full">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-7 max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-slate-400 text-sm mt-0.5">Platform-wide configuration and feature flags</p>
      </div>

      {maintenanceOn && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-6">
          <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-amber-800 text-sm font-semibold">Maintenance mode is active</p>
            <p className="text-amber-600 text-xs mt-0.5">All workspace logins are currently blocked across the platform.</p>
          </div>
        </div>
      )}

      {(['Access & Registration', 'Limits & Quotas', 'Features'] as const).map((section) => {
        const defs = SETTING_DEFS.filter((d) => d.section === section);
        const meta = SECTION_META[section];
        const SectionIcon = meta?.icon ?? Lock;
        return (
          <div key={section} className="bg-white rounded-2xl border border-slate-200 mb-5 overflow-hidden">
            <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <SectionIcon size={14} className="text-slate-500" />
              </div>
              <div>
                <h2 className="text-slate-800 text-sm font-bold">{section}</h2>
                <p className="text-slate-400 text-xs mt-0.5">{meta?.description}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {defs.map((def) => {
                const stored = getStored(def.key);
                const currentVal = getValue(def.key);
                const dirty = isDirty(def);

                return (
                  <div key={def.key} className="px-6 py-5">
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-slate-800 text-sm font-semibold">{def.label}</p>
                          {stored ? (
                            <span className="text-emerald-600 text-[10px] flex items-center gap-0.5 font-medium">
                              <CheckCircle2 size={9} /> Saved
                            </span>
                          ) : (
                            <span className="text-slate-300 text-[10px] font-medium">Default</span>
                          )}
                          {dirty && <span className="text-amber-500 text-[10px] font-semibold">· unsaved changes</span>}
                        </div>
                        <p className="text-slate-400 text-xs mb-4">{def.description}</p>

                        {def.type === 'boolean' ? (
                          <div className="flex items-center gap-3">
                            <Toggle checked={currentVal === true} onChange={(v) => setEditValues((prev) => ({ ...prev, [def.key]: v }))} />
                            <span className={cn('text-sm font-semibold', currentVal === true ? 'text-indigo-600' : 'text-slate-400')}>
                              {currentVal === true ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        ) : def.type === 'number' ? (
                          <input
                            type="number"
                            value={typeof currentVal === 'number' ? currentVal : (parseInt(String(currentVal), 10) || 0)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: parseInt(e.target.value, 10) || 0 }))}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : def.type === 'select' && def.options ? (
                          <select
                            value={String(currentVal ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {def.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={String(currentVal ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                            placeholder={def.key}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-80 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        )}
                      </div>

                      <button
                        onClick={() => { void handleSave(def.key, def.description); }}
                        disabled={!dirty || saving === def.key}
                        className={cn(
                          'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-colors flex-shrink-0 mt-[52px]',
                          dirty ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm' : 'bg-slate-100 text-slate-300 cursor-not-allowed',
                        )}
                      >
                        {saving === def.key ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Custom settings */}
      {customSettings.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 mb-5 overflow-hidden">
          <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Puzzle size={14} className="text-slate-500" />
            </div>
            <div>
              <h2 className="text-slate-800 text-sm font-bold">Custom Settings</h2>
              <p className="text-slate-400 text-xs mt-0.5">Arbitrary settings stored in the database</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {customSettings.map((s) => (
              <div key={s.key} className="px-6 py-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-indigo-600 text-xs font-mono bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">{s.key}</code>
                      <span className="text-emerald-600 text-[10px] flex items-center gap-0.5 font-medium"><CheckCircle2 size={9} /> Saved</span>
                      <span className="text-slate-300 text-[10px]">· {new Date(s.updatedAt).toLocaleDateString()}</span>
                    </div>
                    {s.description && <p className="text-slate-400 text-xs mb-3">{s.description}</p>}
                    <input
                      type="text"
                      value={String(editValues[s.key] ?? JSON.stringify(s.value))}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-80 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    onClick={() => { void handleSave(s.key, s.description); }}
                    disabled={saving === s.key}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl disabled:opacity-40 transition-colors flex-shrink-0 mt-[52px]"
                  >
                    {saving === s.key ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new custom setting */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Plus size={14} className="text-slate-500" />
          </div>
          <div>
            <h2 className="text-slate-800 text-sm font-bold">Add Custom Setting</h2>
            <p className="text-slate-400 text-xs mt-0.5">Store any arbitrary key-value setting in the database</p>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-600 font-semibold uppercase tracking-wide mb-1.5">Key</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="setting_key"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2.5 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold uppercase tracking-wide mb-1.5">Value <span className="text-slate-400 font-normal normal-case">(JSON or plain)</span></label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='"value" or true or 42'
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2.5 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="mb-5">
            <label className="block text-xs text-slate-600 font-semibold uppercase tracking-wide mb-1.5">Description <span className="text-slate-400 font-normal normal-case">(optional)</span></label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="What does this setting control?"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={() => { void handleAddNew(); }}
            disabled={!newKey.trim() || saving === '__new__'}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            {saving === '__new__' ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={13} />}
            Add Setting
          </button>
        </div>
      </div>
    </div>
  );
}
