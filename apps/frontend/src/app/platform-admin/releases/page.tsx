'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Rocket, Plus, CheckCircle2, XCircle, Clock, GitBranch,
  GitCommit, ChevronDown, ChevronUp, RefreshCw, Terminal, Tag,
} from 'lucide-react';
import { platformAdminApi, AppVersion, DeploymentLog } from '@/lib/platform-admin-api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const CHANNEL_COLORS: Record<string, string> = {
  stable:  'bg-green-100 text-green-700',
  beta:    'bg-purple-100 text-purple-700',
  canary:  'bg-orange-100 text-orange-700',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  success:        <CheckCircle2 size={14} className="text-green-500" />,
  failed:         <XCircle size={14} className="text-red-500" />,
  rolling_back:   <RefreshCw size={14} className="text-orange-500" />,
};

function ChangelogSection({ label, items, color }: { label: string; items?: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <div className="mb-2">
      <p className={cn('text-xs font-semibold mb-1', color)}>{label}</p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
            <span className="mt-0.5 text-slate-500">•</span>{item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionCard({ v, onMarkLatest }: { v: AppVersion; onMarkLatest: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cl = v.changelog;

  return (
    <div className={cn(
      'border rounded-2xl p-5 transition-colors',
      v.isLatest ? 'border-teal-500/40 bg-teal-500/5' : 'border-white/8 bg-white/3',
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0">
            <Tag size={16} className="text-teal-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-bold text-lg font-mono">v{v.version}</span>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', CHANNEL_COLORS[v.channel] ?? 'bg-slate-700 text-slate-300')}>
                {v.channel}
              </span>
              {v.isLatest && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  LATEST
                </span>
              )}
            </div>
            {v.description && <p className="text-slate-400 text-xs mt-0.5">{v.description}</p>}
            <p className="text-slate-600 text-[11px] mt-0.5">
              {new Date(v.releasedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {v._count && <span className="ml-2">{v._count.deployments} deployment{v._count.deployments !== 1 ? 's' : ''}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!v.isLatest && (
            <button
              onClick={() => onMarkLatest(v.id)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              Mark Latest
            </button>
          )}
          {cl && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors flex items-center gap-1"
            >
              Changelog {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      </div>

      {expanded && cl && (
        <div className="mt-4 pt-4 border-t border-white/8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChangelogSection label="✨ Features" items={(cl as { features?: string[] }).features} color="text-teal-400" />
          <ChangelogSection label="⚡ Improvements" items={(cl as { improvements?: string[] }).improvements} color="text-blue-400" />
          <ChangelogSection label="🐛 Bug Fixes" items={(cl as { fixes?: string[] }).fixes} color="text-green-400" />
          <ChangelogSection label="🔒 Security" items={(cl as { security?: string[] }).security} color="text-purple-400" />
          <ChangelogSection label="⚠️ Breaking Changes" items={(cl as { breaking?: string[] }).breaking} color="text-red-400" />
        </div>
      )}
    </div>
  );
}

function DeploymentRow({ d }: { d: DeploymentLog }) {
  const duration = d.buildDuration ? `${Math.round(d.buildDuration / 60)}m` : null;
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
      <div className="flex items-center gap-1.5 w-20">
        {STATUS_ICONS[d.status] ?? <Clock size={14} className="text-slate-500" />}
        <span className="text-xs text-slate-400 capitalize">{d.status}</span>
      </div>
      <span className="font-mono text-sm text-teal-400 w-16">v{d.version}</span>
      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium w-20 text-center',
        d.environment === 'production' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400',
      )}>
        {d.environment}
      </span>
      {d.commitHash && (
        <div className="flex items-center gap-1 text-slate-500 text-xs">
          <GitCommit size={11} />{d.commitHash.slice(0, 7)}
        </div>
      )}
      {d.branch && (
        <div className="flex items-center gap-1 text-slate-500 text-xs">
          <GitBranch size={11} />{d.branch}
        </div>
      )}
      <div className="flex-1" />
      {duration && <span className="text-xs text-slate-500">{duration}</span>}
      {d.deployedBy && <span className="text-xs text-slate-500">{d.deployedBy}</span>}
      <span className="text-xs text-slate-600">
        {new Date(d.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

const EMPTY_CHANGELOG = { features: [''], improvements: [''], fixes: [''], breaking: [''], security: [''] };

export default function ReleasesPage() {
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [deployments, setDeployments] = useState<DeploymentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [activeTab, setActiveTab] = useState<'versions' | 'deployments'>('versions');

  const [newVer, setNewVer] = useState({
    version: '', channel: 'stable', description: '', isLatest: true,
    changelog: { ...EMPTY_CHANGELOG },
  });
  const [deployForm, setDeployForm] = useState({
    version: '', environment: 'production', commitHash: '', branch: 'v2',
    deployedBy: 'platform-admin', status: 'success', notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, dRes] = await Promise.allSettled([
      platformAdminApi.listVersions(),
      platformAdminApi.listDeployments(),
    ]);
    if (vRes.status === 'fulfilled') setVersions(vRes.value.data as AppVersion[]);
    if (dRes.status === 'fulfilled') setDeployments(dRes.value.data as DeploymentLog[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!newVer.version) return;
    try {
      const cl: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(newVer.changelog)) {
        const lines = v.filter(Boolean);
        if (lines.length) cl[k] = lines;
      }
      await platformAdminApi.createVersion({ ...newVer, changelog: cl });
      toast.success(`v${newVer.version} created`);
      setShowNew(false);
      void load();
    } catch { toast.error('Failed to create version'); }
  };

  const handleDeploy = async () => {
    if (!deployForm.version) return;
    try {
      await platformAdminApi.logDeployment(deployForm);
      toast.success('Deployment logged');
      setShowDeploy(false);
      void load();
    } catch { toast.error('Failed to log deployment'); }
  };

  const handleMarkLatest = async (id: string) => {
    try {
      await platformAdminApi.updateVersion(id, { isLatest: true });
      toast.success('Marked as latest');
      void load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Rocket size={17} className="text-teal-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg">Release Management</h1>
            <p className="text-slate-500 text-xs">SemVer versioning, deployment tracking, changelog</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowDeploy(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition-colors">
            <Terminal size={14} /> Log Deploy
          </button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-sm transition-colors border border-teal-500/25">
            <Plus size={14} /> New Version
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-white/4 rounded-xl p-1 w-fit">
        {(['versions', 'deployments'] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
              activeTab === t ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
            )}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        </div>
      ) : activeTab === 'versions' ? (
        <div className="space-y-3">
          {versions.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-10">No versions yet</p>
          )}
          {versions.map((v) => (
            <VersionCard key={v.id} v={v} onMarkLatest={handleMarkLatest} />
          ))}
        </div>
      ) : (
        <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
          {deployments.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-10">No deployments logged yet</p>
          ) : (
            deployments.map((d) => <DeploymentRow key={d.id} d={d} />)
          )}
        </div>
      )}

      {/* New Version Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#0d1829] border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-white font-bold text-base mb-5 flex items-center gap-2">
              <Tag size={16} className="text-teal-400" /> New Release
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Version (SemVer) *</label>
                  <input value={newVer.version} onChange={e => setNewVer(p => ({ ...p, version: e.target.value }))}
                    placeholder="2.1.0" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Channel</label>
                  <select value={newVer.channel} onChange={e => setNewVer(p => ({ ...p, channel: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                    <option value="stable">stable</option>
                    <option value="beta">beta</option>
                    <option value="canary">canary</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <input value={newVer.description} onChange={e => setNewVer(p => ({ ...p, description: e.target.value }))}
                  placeholder="Short summary of this release" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50" />
              </div>
              {(['features', 'improvements', 'fixes', 'breaking', 'security'] as const).map((section) => (
                <div key={section}>
                  <label className="text-xs text-slate-400 mb-1 block capitalize">{section} (one per line)</label>
                  <textarea
                    value={newVer.changelog[section].join('\n')}
                    onChange={e => setNewVer(p => ({ ...p, changelog: { ...p.changelog, [section]: e.target.value.split('\n') } }))}
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50 resize-none"
                  />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={newVer.isLatest} onChange={e => setNewVer(p => ({ ...p, isLatest: e.target.checked }))}
                  className="accent-teal-500" />
                Mark as latest version
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => void handleCreate()} className="px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-sm rounded-xl border border-teal-500/25">
                Create v{newVer.version || '?'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Deployment Modal */}
      {showDeploy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#0d1829] border border-white/10 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-base mb-5 flex items-center gap-2">
              <Terminal size={16} className="text-teal-400" /> Log Deployment
            </h2>
            <div className="space-y-3">
              {[
                { key: 'version', label: 'Version *', ph: '2.0.0' },
                { key: 'commitHash', label: 'Commit Hash', ph: 'abc1234' },
                { key: 'branch', label: 'Branch', ph: 'v2' },
                { key: 'deployedBy', label: 'Deployed By', ph: 'platform-admin' },
                { key: 'notes', label: 'Notes', ph: 'Optional notes...' },
              ].map(({ key, label, ph }) => (
                <div key={key}>
                  <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                  <input value={(deployForm as Record<string, string>)[key]}
                    onChange={e => setDeployForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Environment</label>
                  <select value={deployForm.environment} onChange={e => setDeployForm(p => ({ ...p, environment: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                    <option value="production">production</option>
                    <option value="staging">staging</option>
                    <option value="development">development</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Status</label>
                  <select value={deployForm.status} onChange={e => setDeployForm(p => ({ ...p, status: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                    <option value="success">success</option>
                    <option value="failed">failed</option>
                    <option value="rolling_back">rolling_back</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowDeploy(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => void handleDeploy()} className="px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-sm rounded-xl border border-teal-500/25">
                Log Deployment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
