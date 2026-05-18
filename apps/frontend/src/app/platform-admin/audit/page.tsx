'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ScrollText, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { adminAuditApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface AuditLog {
  id: string; action: string; resourceType: string | null; resourceId: string | null;
  metadata: Record<string, unknown> | null; ipAddress: string | null; createdAt: string;
  admin: { id: string; email: string; name: string } | null;
}

const ACTION_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  ADMIN_LOGIN:            { label: 'Admin Login',          badge: 'text-blue-700 bg-blue-50 border-blue-200',      dot: 'bg-blue-500'    },
  ADMIN_LOGOUT:           { label: 'Admin Logout',         badge: 'text-slate-500 bg-slate-100 border-slate-200',  dot: 'bg-slate-400'   },
  ADMIN_LOGIN_FAILED:     { label: 'Login Failed',         badge: 'text-red-600 bg-red-50 border-red-200',         dot: 'bg-red-500'     },
  WORKSPACE_SUSPENDED:    { label: 'Workspace Suspended',  badge: 'text-red-700 bg-red-50 border-red-200',         dot: 'bg-red-600'     },
  WORKSPACE_REACTIVATED:  { label: 'Workspace Activated',  badge: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-600' },
  WORKSPACE_DELETED:      { label: 'Workspace Deleted',    badge: 'text-red-800 bg-red-50 border-red-300',         dot: 'bg-red-700'     },
  WORKSPACE_PLAN_CHANGED: { label: 'Plan Changed',         badge: 'text-indigo-700 bg-indigo-50 border-indigo-200', dot: 'bg-indigo-600'  },
  IMPERSONATION_STARTED:  { label: 'Impersonation',        badge: 'text-amber-700 bg-amber-50 border-amber-200',   dot: 'bg-amber-500'   },
  USER_SUSPENDED:         { label: 'User Suspended',       badge: 'text-orange-700 bg-orange-50 border-orange-200', dot: 'bg-orange-500'  },
  USER_REACTIVATED:       { label: 'User Reactivated',     badge: 'text-teal-700 bg-teal-50 border-teal-200',      dot: 'bg-teal-500'    },
  USER_FORCE_LOGOUT:      { label: 'Force Logout',         badge: 'text-blue-600 bg-blue-50 border-blue-200',      dot: 'bg-blue-400'    },
  SETTING_UPDATED:        { label: 'Setting Updated',      badge: 'text-purple-700 bg-purple-50 border-purple-200', dot: 'bg-purple-500'  },
  ADMIN_SETUP:            { label: 'Admin Setup',          badge: 'text-violet-700 bg-violet-50 border-violet-200', dot: 'bg-violet-500'  },
};

const QUICK_FILTERS = ['IMPERSONATION_STARTED', 'WORKSPACE_SUSPENDED', 'WORKSPACE_DELETED', 'USER_SUSPENDED', 'SETTING_UPDATED'];

function relativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAuditApi.list({ page, limit: 50, action: actionFilter || undefined });
      const data = res.data as { data: AuditLog[]; total: number; pages: number };
      setLogs(data.data);
      setTotal(data.total);
      setPages(data.pages);
    } catch { toast.error('Failed to load audit logs'); }
    finally { setLoading(false); }
  }, [page, actionFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [actionFilter]);

  const filteredLogs = searchQuery
    ? logs.filter((l) =>
        l.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.admin?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.admin?.name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : logs;

  return (
    <div className="p-7 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} events recorded · all admin actions are logged</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
        <Filter size={13} className="text-slate-400 flex-shrink-0" />
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email or action…"
            className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg pl-8 pr-3 py-1.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
        {(searchQuery || actionFilter) && (
          <button onClick={() => { setSearchQuery(''); setActionFilter(''); }} className="text-slate-400 hover:text-slate-600 text-xs transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Quick filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {QUICK_FILTERS.map((a) => {
          const cfg = ACTION_CONFIG[a];
          return (
            <button
              key={a}
              onClick={() => setActionFilter((v) => v === a ? '' : a)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors flex items-center gap-1.5',
                actionFilter === a ? (cfg?.badge ?? 'bg-slate-100 text-slate-600 border-slate-200') : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', cfg?.dot ?? 'bg-slate-400')} />
              {cfg?.label ?? a}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading audit log…</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <ScrollText size={28} className="text-slate-200" />
            <p className="text-sm">No audit events found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredLogs.map((log) => {
              const cfg = ACTION_CONFIG[log.action];
              return (
                <div key={log.id}>
                  <div className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50/40 transition-colors">
                    {/* Dot + avatar column */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg?.dot ?? 'bg-slate-300')} />
                    </div>
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-[10px] font-bold flex-shrink-0">
                      {log.admin?.name?.slice(0, 2).toUpperCase() ?? 'SY'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0', cfg?.badge ?? 'text-slate-500 bg-slate-50 border-slate-200')}>
                              {cfg?.label ?? log.action.replace(/_/g, ' ')}
                            </span>
                            <span className="text-slate-700 text-sm font-medium">{log.admin?.name ?? 'System'}</span>
                            <span className="text-slate-400 text-xs truncate">{log.admin?.email ?? ''}</span>
                          </div>
                          {log.resourceType && (
                            <p className="text-slate-500 text-xs mt-0.5">
                              on <span className="font-medium text-slate-600">{log.resourceType}</span>
                              {log.metadata && typeof log.metadata['name'] === 'string' && (
                                <span className="text-slate-400 italic"> &ldquo;{log.metadata['name'] as string}&rdquo;</span>
                              )}
                            </p>
                          )}
                          <div className="flex items-center gap-2.5 mt-1.5">
                            <span className="text-slate-400 text-[10px]">{new Date(log.createdAt).toLocaleString()}</span>
                            <span className="text-slate-300 text-[10px]">·</span>
                            <span className="text-slate-400 text-[10px]">{relativeTime(log.createdAt)}</span>
                            {log.ipAddress && (
                              <>
                                <span className="text-slate-300 text-[10px]">·</span>
                                <span className="text-slate-400 text-[10px] font-mono">{log.ipAddress}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <button
                            onClick={() => setExpandedId((v) => v === log.id ? null : log.id)}
                            className="flex items-center gap-1 text-slate-400 hover:text-slate-600 text-[10px] font-medium transition-colors flex-shrink-0"
                          >
                            {expandedId === log.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            metadata
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedId === log.id && log.metadata && (
                    <div className="px-[72px] pb-4">
                      <pre className="text-slate-600 text-xs bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page <span className="font-medium text-slate-600">{page}</span> of <span className="font-medium text-slate-600">{pages}</span>
              {' · '}<span className="font-medium text-slate-600">{total.toLocaleString()}</span> events
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
