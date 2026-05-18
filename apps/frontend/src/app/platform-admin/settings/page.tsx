'use client';
import { useEffect, useState } from 'react';
import { Save, Plus, AlertCircle, CheckCircle2, Settings, Lock, Sliders, Cpu, Puzzle } from 'lucide-react';
import { adminSettingsApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlatformSetting {
  id: string; key: string; value: unknown; description: string | null; updatedAt: string; updatedBy: string | null;
}

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'boolean' | 'number' | 'text' | 'select';
  options?: string[];
  section: string;
}

const SETTING_DEFS: SettingDef[] = [
  // Access & Registration
  { key: 'registration_enabled', label: 'New Registrations', description: 'Allow new workspace registrations on the platform', type: 'boolean', section: 'Access & Registration' },
  { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Put the platform in maintenance mode — blocks all workspace logins', type: 'boolean', section: 'Access & Registration' },
  { key: 'default_plan', label: 'Default Plan', description: 'Plan assigned to newly registered workspaces', type: 'select', options: ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'], section: 'Access & Registration' },
  { key: 'support_email', label: 'Support Email', description: 'Platform support email shown to users', type: 'text', section: 'Access & Registration' },
  // Limits & Quotas
  { key: 'max_free_agents', label: 'Free Plan Agent Limit', description: 'Maximum agents allowed on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'max_free_contacts', label: 'Free Plan Contact Limit', description: 'Maximum contacts allowed on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'max_free_messages_per_day', label: 'Free Plan Daily Messages', description: 'Maximum messages per day on the free plan', type: 'number', section: 'Limits & Quotas' },
  { key: 'upload_max_mb', label: 'Max Upload Size (MB)', description: 'Maximum file upload size in megabytes', type: 'number', section: 'Limits & Quotas' },
  // Features
  { key: 'ai_enabled', label: 'AI Features', description: 'Enable or disable AI features across the entire platform', type: 'boolean', section: 'Features' },
];

const SECTION_ICONS: Record<string, React.ElementType> = {
  'Access & Registration': Lock,
  'Limits & Quotas': Sliders,
  'Features': Cpu,
  'Custom': Puzzle,
};

const DEFAULT_VALUES: Record<string, unknown> = {
  maintenance_mode: false,
  registration_enabled: true,
  max_free_agents: 3,
  max_free_contacts: 500,
  max_free_messages_per_day: 1000,
  ai_enabled: true,
  upload_max_mb: 64,
  default_plan: 'FREE',
  support_email: '',
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-5.5 h-[22px] rounded-full transition-colors flex-shrink-0',
        checked ? 'bg-indigo-600' : 'bg-slate-200',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
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
      setEditValues((prev) => ({ ...prev, [newKey.trim()]: parsed }));
      setNewKey(''); setNewValue(''); setNewDesc('');
      toast.success(`Setting "${newKey.trim()}" created`);
    } catch { toast.error('Failed to create setting'); }
    finally { setSaving(null); }
  };

  const getValue = (key: string) => {
    return key in editValues ? editValues[key] : DEFAULT_VALUES[key];
  };

  const getStored = (key: string) => settings.find((s) => s.key === key);

  const isDirty = (def: SettingDef) => {
    const stored = getStored(def.key);
    const currentVal = getValue(def.key);
    const storedVal = stored?.value ?? DEFAULT_VALUES[def.key];
    return JSON.stringify(currentVal) !== JSON.stringify(storedVal);
  };

  // Group known settings by section
  const sections = ['Access & Registration', 'Limits & Quotas', 'Features'];

  // Find custom settings (in DB but not in SETTING_DEFS)
  const knownKeys = new Set(SETTING_DEFS.map((d) => d.key));
  const customSettings = settings.filter((s) => !knownKeys.has(s.key));

  if (loading) return (
    <div className="p-6 flex items-center justify-center py-24">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const maintenanceSetting = settings.find((s) => s.key === 'maintenance_mode');
  const maintenanceOn = (getValue('maintenance_mode') as boolean) === true;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-slate-900 text-xl font-bold">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform-wide configuration</p>
      </div>

      {/* Maintenance banner */}
      {maintenanceOn && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <AlertCircle size={15} className="text-amber-600 flex-shrink-0" />
          <p className="text-amber-700 text-sm font-medium">Maintenance mode is <strong>ON</strong> — workspace logins are currently blocked</p>
        </div>
      )}

      {/* Settings sections */}
      {sections.map((section) => {
        const defs = SETTING_DEFS.filter((d) => d.section === section);
        const SectionIcon = SECTION_ICONS[section] ?? Settings;
        return (
          <div key={section} className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-5 overflow-hidden">
            {/* Section header */}
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50/60">
              <SectionIcon size={14} className="text-slate-500" />
              <h2 className="text-slate-800 text-sm font-semibold">{section}</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {defs.map((def) => {
                const stored = getStored(def.key);
                const currentVal = getValue(def.key);
                const dirty = isDirty(def);

                return (
                  <div key={def.key} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-slate-800 text-sm font-semibold">{def.label}</p>
                          {stored ? (
                            <span className="text-emerald-600 text-[10px] flex items-center gap-0.5 font-medium">
                              <CheckCircle2 size={9} /> Saved
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Default</span>
                          )}
                          {stored?.updatedAt && (
                            <span className="text-slate-300 text-[10px]">· {new Date(stored.updatedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs mb-3">{def.description}</p>

                        {def.type === 'boolean' ? (
                          <div className="flex items-center gap-2.5">
                            <Toggle
                              checked={currentVal === true}
                              onChange={(v) => setEditValues((prev) => ({ ...prev, [def.key]: v }))}
                            />
                            <span className={cn('text-sm font-medium', currentVal === true ? 'text-indigo-600' : 'text-slate-400')}>
                              {currentVal === true ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        ) : def.type === 'number' ? (
                          <input
                            type="number"
                            value={typeof currentVal === 'number' ? currentVal : (parseInt(String(currentVal), 10) || 0)}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: parseInt(e.target.value, 10) || 0 }))}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        ) : def.type === 'select' && def.options ? (
                          <select
                            value={String(currentVal ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {def.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={String(currentVal ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                            placeholder={def.key}
                            className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        )}
                      </div>

                      <button
                        onClick={() => { void handleSave(def.key, def.description); }}
                        disabled={!dirty || saving === def.key}
                        className={cn(
                          'flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex-shrink-0 mt-6',
                          dirty
                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-500/20'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed',
                        )}
                      >
                        {saving === def.key ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Save size={12} />
                        )}
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
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50/60">
            <Puzzle size={14} className="text-slate-500" />
            <h2 className="text-slate-800 text-sm font-semibold">Custom</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {customSettings.map((s) => (
              <div key={s.key} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <code className="text-indigo-600 text-xs font-mono bg-indigo-50 px-1.5 py-0.5 rounded">{s.key}</code>
                      <span className="text-emerald-600 text-[10px] flex items-center gap-0.5 font-medium">
                        <CheckCircle2 size={9} /> Saved
                      </span>
                      <span className="text-slate-300 text-[10px]">· {new Date(s.updatedAt).toLocaleDateString()}</span>
                    </div>
                    {s.description && <p className="text-slate-400 text-xs mb-2">{s.description}</p>}
                    <input
                      type="text"
                      value={String(editValues[s.key] ?? JSON.stringify(s.value))}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      className="bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 w-72 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={() => { void handleSave(s.key, s.description); }}
                    disabled={saving === s.key}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl disabled:opacity-40 transition-colors flex-shrink-0 mt-6"
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

      {/* Add custom setting */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <Plus size={14} className="text-slate-500" />
          <h2 className="text-slate-800 text-sm font-semibold">Add Custom Setting</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-600 font-medium mb-1.5">Key</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="setting_key"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-medium mb-1.5">Value (JSON or plain)</label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='"value" or true or 42'
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-slate-600 font-medium mb-1.5">Description <span className="text-slate-400">(optional)</span></label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="What does this setting control?"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-3.5 py-2 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => { void handleAddNew(); }}
            disabled={!newKey.trim() || saving === '__new__'}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-indigo-500/20"
          >
            {saving === '__new__' ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Add Setting
          </button>
        </div>
      </div>
    </div>
  );
}
