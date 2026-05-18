'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { adminAuditApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface AuditLog {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  admin: { id: string; email: string; name: string } | null;
}

const ACTION_COLORS: Record<string, string> = {
  ADMIN_LOGIN: 'bg-blue-50 text-blue-700 border-blue-200',
  ADMIN_LOGOUT: 'bg-slate-100 text-slate-500 border-slate-200',
  ADMIN_LOGIN_FAILED: 'bg-red-50 text-red-600 border-red-200',
  WORKSPACE_SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
  WORKSPACE_REACTIVATED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WORKSPACE_DELETED: 'bg-red-50 text-red-800 border-red-300',
  WORKSPACE_PLAN_CHANGED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  IMPERSONATION_STARTED: 'bg-amber-50 text-amber-700 border-amber-200',
  USER_SUSPENDED: 'bg-orange-50 text-orange-700 border-orange-200',
  USER_REACTIVATED: 'bg-teal-50 text-teal-700 border-teal-200',
  USER_FORCE_LOGOUT: 'bg-blue-50 text-blue-600 border-blue-200',
  SETTING_UPDATED: 'bg-purple-50 text-purple-700 border-purple-200',
  ADMIN_SETUP: 'bg-violet-50 text-violet-700 border-violet-200',
};

const LEFT_BORDER: Record<string, string> = {
  ADMIN_LOGIN: 'border-l-blue-400',
  ADMIN_LOGOUT: 'border-l-slate-300',
  ADMIN_LOGIN_FAILED: 'border-l-red-400',
  WORKSPACE_SUSPENDED: 'border-l-red-500',
  WORKSPACE_REACTIVATED: 'border-l-emerald-500',
  WORKSPACE_DELETED: 'border-l-red-600',
  WORKSPACE_PLAN_CHANGED: 'border-l-indigo-500',
  IMPERSONATION_STARTED: 'border-l-amber-500',
  USER_SUSPENDED: 'border-l-orange-500',
  USER_REACTIVATED: 'border-l-teal-500',
  USER_FORCE_LOGOUT: 'border-l-blue-400',
  SETTING_UPDATED: 'border-l-purple-500',
  ADMIN_SETUP: 'border-l-violet-500',
};

const ACTION_TYPES = [
  'IMPERSONATION_STARTED',
  'WORKSPACE_SUSPENDED',
  'WORKSPACE_REACTIVATED',
  'WORKSPACE_DELETED',
  'WORKSPACE_PLAN_CHANGED',
  'USER_SUSPENDED',
  'USER_REACTIVATED',
  'USER_FORCE_LOGOUT',
  'ADMIN_LOGIN',
  'ADMIN_LOGOUT',
  'SETTING_UPDATED',
];

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
      const res = await adminAuditApi.list({
        page, limit: 50,
        action: actionFilter || undefined,
      });
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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Audit Log</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {total.toLocaleString()} total events · <span className="text-slate-400">Export not available via UI</span>
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email or action…"
            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl pl-9 pr-3 py-2 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="bg-white border border-slate-200 text-slate-600 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        >
          <option value="">All actions</option>
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Quick filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {['IMPERSONATION_STARTED', 'WORKSPACE_SUSPENDED', 'WORKSPACE_DELETED', 'USER_SUSPENDED', 'SETTING_UPDATED'].map((a) => (
          <button
            key={a}
            onClick={() => setActionFilter((v) => v === a ? '' : a)}
            className={cn(
              'px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors',
              actionFilter === a
                ? (ACTION_COLORS[a] ?? 'bg-slate-100 text-slate-500 border-slate-200')
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
            )}
          >
            {a.replace(/_/g, ' ')}
          </button>
        ))}
        {actionFilter && (
          <button
            onClick={() => setActionFilter('')}
            className="px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading audit log…</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <ScrollText size={28} className="text-slate-300" />
            <p className="text-sm">No audit events found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className={cn(
                  'border-l-4 transition-colors',
                  LEFT_BORDER[log.action] ?? 'border-l-slate-200',
                )}
              >
                {/* Main row */}
                <div className="flex items-start gap-4 px-5 py-4">
                  {/* Admin avatar */}
                  <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0 mt-0.5">
                    {log.admin?.name?.slice(0, 2).toUpperCase() ?? 'SY'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0', ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-slate-700 text-sm font-medium">{log.admin?.name ?? 'System'}</span>
                          <span className="text-slate-400 text-xs">{log.admin?.email ?? ''}</span>
                        </div>
                        {log.resourceType && (
                          <p className="text-slate-500 text-xs">
                            on <span className="font-medium text-slate-600">{log.resourceType}</span>
                            {log.metadata && typeof log.metadata['name'] === 'string' && (
                              <span className="italic"> &ldquo;{log.metadata['name'] as string}&rdquo;</span>
                            )}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
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

                      {/* Expand toggle */}
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <button
                          onClick={() => setExpandedId((v) => v === log.id ? null : log.id)}
                          className="flex items-center gap-1 text-slate-400 hover:text-slate-600 text-[10px] font-medium transition-colors flex-shrink-0 mt-1"
                        >
                          {expandedId === log.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {expandedId === log.id ? 'Hide' : 'Show'} metadata
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded metadata */}
                {expandedId === log.id && log.metadata && (
                  <div className="px-5 pb-4 bg-slate-50/60">
                    <pre className="text-slate-600 text-xs bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page {page} of {pages} · <span className="font-medium text-slate-600">{total.toLocaleString()}</span> events
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
