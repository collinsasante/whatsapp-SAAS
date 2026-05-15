'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
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
  ADMIN_LOGIN: 'text-emerald-400 bg-emerald-950/50 border-emerald-900/50',
  ADMIN_LOGOUT: 'text-gray-400 bg-gray-800 border-gray-700',
  ADMIN_LOGIN_FAILED: 'text-red-400 bg-red-950/50 border-red-900/50',
  WORKSPACE_SUSPENDED: 'text-red-400 bg-red-950/50 border-red-900/50',
  WORKSPACE_REACTIVATED: 'text-emerald-400 bg-emerald-950/50 border-emerald-900/50',
  WORKSPACE_DELETED: 'text-red-500 bg-red-950/60 border-red-900/60',
  WORKSPACE_PLAN_CHANGED: 'text-violet-400 bg-violet-950/50 border-violet-900/50',
  IMPERSONATION_STARTED: 'text-amber-400 bg-amber-950/50 border-amber-900/50',
  USER_SUSPENDED: 'text-orange-400 bg-orange-950/50 border-orange-900/50',
  USER_REACTIVATED: 'text-teal-400 bg-teal-950/50 border-teal-900/50',
  USER_FORCE_LOGOUT: 'text-blue-400 bg-blue-950/50 border-blue-900/50',
  SETTING_UPDATED: 'text-cyan-400 bg-cyan-950/50 border-cyan-900/50',
  ADMIN_SETUP: 'text-violet-400 bg-violet-950/50 border-violet-900/50',
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-bold">Audit Logs</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total.toLocaleString()} total events logged</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by action…"
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl pl-9 pr-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['IMPERSONATION_STARTED', 'WORKSPACE_SUSPENDED', 'WORKSPACE_DELETED', 'USER_SUSPENDED'].map((a) => (
            <button key={a} onClick={() => setActionFilter((v) => v === a ? '' : a)}
              className={cn('px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors',
                actionFilter === a
                  ? (ACTION_COLORS[a] ?? 'bg-gray-800 text-gray-400 border-gray-700')
                  : 'bg-gray-800 text-gray-600 border-gray-700 hover:border-gray-600')}>
              {a.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-600">
            <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-600">
            <ClipboardList size={24} className="text-gray-700" />
            <p className="text-sm">No audit logs found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {logs.map((log) => (
              <div key={log.id}>
                <button
                  onClick={() => setExpandedId((v) => v === log.id ? null : log.id)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-gray-800/30 transition-colors text-left"
                >
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border flex-shrink-0 mt-0.5', ACTION_COLORS[log.action] ?? 'text-gray-400 bg-gray-800 border-gray-700')}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-300 text-xs font-medium">{log.admin?.email ?? 'System'}</span>
                      {log.resourceType && (
                        <span className="text-gray-600 text-[10px]">on {log.resourceType}</span>
                      )}
                      {log.metadata && typeof log.metadata['name'] === 'string' && (
                        <span className="text-gray-500 text-[10px] italic">"{log.metadata['name'] as string}"</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-gray-700 text-[10px]">{new Date(log.createdAt).toLocaleString()}</span>
                      {log.ipAddress && <span className="text-gray-700 text-[10px]">{log.ipAddress}</span>}
                    </div>
                  </div>
                </button>

                {expandedId === log.id && log.metadata && (
                  <div className="px-4 pb-3 bg-gray-950/50">
                    <pre className="text-gray-500 text-[10px] bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-600 text-xs">Page {page} of {pages} · {total.toLocaleString()} events</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
