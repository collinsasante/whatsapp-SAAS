'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Flag, Plus, Trash2, ChevronDown, ChevronUp,
  ToggleLeft, ToggleRight, Percent, Users, Globe, AlertTriangle,
} from 'lucide-react';
import { platformAdminApi, FeatureFlag, FlagRollout } from '@/lib/platform-admin-api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const ROLLOUT_ICONS: Record<string, React.ReactNode> = {
  all:        <Globe size={12} />,
  percentage: <Percent size={12} />,
  tenants:    <Users size={12} />,
  beta:       <Users size={12} />,
};

const CATEGORY_COLORS: Record<string, string> = {
  ai:       'bg-purple-500/15 text-purple-400',
  calls:    'bg-blue-500/15 text-blue-400',
  beta:     'bg-orange-500/15 text-orange-400',
  billing:  'bg-green-500/15 text-green-400',
  ui:       'bg-teal-500/15 text-teal-400',
};

function RolloutsPanel({ flag, onClose }: { flag: FeatureFlag; onClose: () => void }) {
  const [rollouts, setRollouts] = useState<FlagRollout[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    const res = await platformAdminApi.getFlagRollouts(flag.id);
    setRollouts(res.data as FlagRollout[]);
  }, [flag.id]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    if (!tenantId.trim()) return;
    try {
      await platformAdminApi.setFlagRollout(flag.id, tenantId.trim(), enabled);
      toast.success('Rollout saved');
      setTenantId('');
      void load();
    } catch { toast.error('Failed'); }
  };

  const handleRemove = async (tid: string) => {
    try {
      await platformAdminApi.removeFlagRollout(flag.id, tid);
      toast.success('Removed');
      void load();
    } catch { toast.error('Failed'); }
  };

  const handleToggle = async (r: FlagRollout) => {
    try {
      await platformAdminApi.setFlagRollout(flag.id, r.tenantId, !r.enabled);
      void load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#0d1829] border border-white/10 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold">{flag.name}</h3>
            <p className="text-slate-500 text-xs font-mono">{flag.key}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Add rollout */}
        <div className="flex gap-2 mb-4">
          <input
            value={tenantId} onChange={e => setTenantId(e.target.value)}
            placeholder="Tenant ID"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50"
          />
          <select value={enabled ? '1' : '0'} onChange={e => setEnabled(e.target.value === '1')}
            className="bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-white text-sm">
            <option value="1">On</option>
            <option value="0">Off</option>
          </select>
          <button onClick={() => void handleAdd()}
            className="px-3 py-2 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-sm rounded-xl border border-teal-500/25">
            <Plus size={14} />
          </button>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {rollouts.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">No per-tenant rollouts — flag applies globally</p>
          ) : rollouts.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2.5 bg-white/3 rounded-xl border border-white/6">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{r.tenant?.name ?? r.tenantId}</p>
                <p className="text-slate-600 text-[10px] font-mono">{r.tenantId}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void handleToggle(r)}>
                  {r.enabled
                    ? <ToggleRight size={22} className="text-teal-400" />
                    : <ToggleLeft size={22} className="text-slate-600" />}
                </button>
                <button onClick={() => void handleRemove(r.tenantId)} className="text-slate-600 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FlagRow({ flag, onUpdate, onDelete }: {
  flag: FeatureFlag;
  onUpdate: (id: string, data: Partial<FeatureFlag>) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRollouts, setShowRollouts] = useState(false);

  return (
    <>
      <div className={cn(
        'border-b border-white/5 last:border-0 transition-colors hover:bg-white/2',
        flag.killSwitch && 'bg-red-500/5',
      )}>
        <div className="flex items-center gap-4 px-5 py-3.5">
          {/* Toggle */}
          <button
            onClick={() => onUpdate(flag.id, { enabled: !flag.enabled })}
            disabled={flag.killSwitch}
            className="flex-shrink-0"
            title={flag.killSwitch ? 'Kill switch active' : ''}
          >
            {flag.enabled && !flag.killSwitch
              ? <ToggleRight size={26} className="text-teal-400" />
              : <ToggleLeft size={26} className="text-slate-600" />}
          </button>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-medium text-sm">{flag.name}</span>
              <code className="text-slate-500 text-[11px] bg-white/5 px-1.5 py-0.5 rounded-md">{flag.key}</code>
              {flag.category && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium capitalize', CATEGORY_COLORS[flag.category] ?? 'bg-slate-700/50 text-slate-400')}>
                  {flag.category}
                </span>
              )}
              {flag.killSwitch && (
                <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-400 font-semibold">
                  <AlertTriangle size={9} /> KILL SWITCH
                </span>
              )}
            </div>
            {flag.description && <p className="text-slate-500 text-xs mt-0.5 truncate">{flag.description}</p>}
          </div>

          {/* Rollout type */}
          <div className="flex items-center gap-1 text-slate-400 text-xs bg-white/4 px-2 py-1 rounded-lg">
            {ROLLOUT_ICONS[flag.rolloutType]}
            <span className="capitalize">{flag.rolloutType}</span>
            {flag.rolloutType === 'percentage' && <span>{flag.rolloutPct}%</span>}
            {flag._count && flag._count.rollouts > 0 && (
              <span className="ml-1 text-teal-500">{flag._count.rollouts}↗</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button onClick={() => setShowRollouts(true)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              Rollouts
            </button>
            <button onClick={() => setExpanded(e => !e)}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button onClick={() => onDelete(flag.id)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/15 text-slate-600 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Expanded editor */}
        {expanded && (
          <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-white/5 pt-3">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Rollout Type</label>
              <select value={flag.rolloutType}
                onChange={e => onUpdate(flag.id, { rolloutType: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none">
                <option value="all">All tenants</option>
                <option value="percentage">Percentage</option>
                <option value="tenants">Specific tenants</option>
              </select>
            </div>
            {flag.rolloutType === 'percentage' && (
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Rollout %</label>
                <input type="number" min="0" max="100" value={flag.rolloutPct}
                  onChange={e => onUpdate(flag.id, { rolloutPct: Number(e.target.value) })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none" />
              </div>
            )}
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Category</label>
              <select value={flag.category ?? ''}
                onChange={e => onUpdate(flag.id, { category: e.target.value || undefined })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none">
                <option value="">— none —</option>
                <option value="ai">ai</option>
                <option value="calls">calls</option>
                <option value="beta">beta</option>
                <option value="billing">billing</option>
                <option value="ui">ui</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={flag.killSwitch}
                  onChange={e => onUpdate(flag.id, { killSwitch: e.target.checked })}
                  className="accent-red-500" />
                <span className="text-red-400">Kill switch</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {showRollouts && <RolloutsPanel flag={flag} onClose={() => setShowRollouts(false)} />}
    </>
  );
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: '', name: '', description: '', category: '', rolloutType: 'all', rolloutPct: 100, enabled: false });
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformAdminApi.listFlags();
      setFlags(res.data as FeatureFlag[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (id: string, data: Partial<FeatureFlag>) => {
    try {
      await platformAdminApi.updateFlag(id, data);
      setFlags(f => f.map(x => x.id === id ? { ...x, ...data } : x));
    } catch { toast.error('Failed to update'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await platformAdminApi.deleteFlag(id);
      setFlags(f => f.filter(x => x.id !== id));
      toast.success('Deleted');
    } catch { toast.error('Failed'); }
  };

  const handleCreate = async () => {
    if (!newFlag.key || !newFlag.name) { toast.error('Key and name required'); return; }
    try {
      await platformAdminApi.createFlag(newFlag);
      toast.success(`${newFlag.key} created`);
      setShowNew(false);
      setNewFlag({ key: '', name: '', description: '', category: '', rolloutType: 'all', rolloutPct: 100, enabled: false });
      void load();
    } catch { toast.error('Failed to create'); }
  };

  const visible = flags.filter(f =>
    filter === 'all' ? true : filter === 'enabled' ? f.enabled && !f.killSwitch : !f.enabled || f.killSwitch,
  );

  const enabledCount = flags.filter(f => f.enabled && !f.killSwitch).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <Flag size={17} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg">Feature Flags</h1>
            <p className="text-slate-500 text-xs">{enabledCount} of {flags.length} enabled · tenant rollouts · kill switches</p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-sm transition-colors border border-purple-500/25">
          <Plus size={14} /> New Flag
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-4 bg-white/4 rounded-xl p-1 w-fit">
        {(['all', 'enabled', 'disabled'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
              filter === f ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
            )}>
            {f}
          </button>
        ))}
      </div>

      {/* Flags list */}
      <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">
            {flags.length === 0 ? 'No feature flags yet — create your first one' : 'No flags match this filter'}
          </p>
        ) : (
          visible.map((flag) => (
            <FlagRow key={flag.id} flag={flag} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))
        )}
      </div>

      {/* New Flag Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#0d1829] border border-white/10 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-base mb-5 flex items-center gap-2">
              <Flag size={15} className="text-purple-400" /> New Feature Flag
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Key * (snake_case)</label>
                <input value={newFlag.key} onChange={e => setNewFlag(p => ({ ...p, key: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                  placeholder="ai_copilot_beta" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50 font-mono" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                <input value={newFlag.name} onChange={e => setNewFlag(p => ({ ...p, name: e.target.value }))}
                  placeholder="AI Copilot Beta" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <input value={newFlag.description} onChange={e => setNewFlag(p => ({ ...p, description: e.target.value }))}
                  placeholder="What this flag controls" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Category</label>
                  <select value={newFlag.category} onChange={e => setNewFlag(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                    <option value="">— none —</option>
                    <option value="ai">ai</option>
                    <option value="calls">calls</option>
                    <option value="beta">beta</option>
                    <option value="billing">billing</option>
                    <option value="ui">ui</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Rollout</label>
                  <select value={newFlag.rolloutType} onChange={e => setNewFlag(p => ({ ...p, rolloutType: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                    <option value="all">All tenants</option>
                    <option value="percentage">Percentage</option>
                    <option value="tenants">Specific tenants</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={newFlag.enabled} onChange={e => setNewFlag(p => ({ ...p, enabled: e.target.checked }))}
                  className="accent-purple-500" />
                Enable immediately
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => void handleCreate()}
                className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-sm rounded-xl border border-purple-500/25">
                Create Flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
