'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { adminAuditApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  admin: { id: string; email: string; name: string } | null;
}

const ACTION_COLORS: Record<string, string> = {
  WORKSPACE_SUSPENDED: 'text-amber-400 bg-amber-900/20',
  WORKSPACE_REACTIVATED: 'text-[#25D366] bg-emerald-900/20',
  WORKSPACE_DELETED: 'text-red-400 bg-red-900/20',
  WORKSPACE_PLAN_CHANGED: 'text-blue-400 bg-blue-900/20',
  USER_SUSPENDED: 'text-amber-400 bg-amber-900/20',
  USER_REACTIVATED: 'text-[#25D366] bg-emerald-900/20',
  USER_FORCE_LOGOUT: 'text-slate-400 bg-slate-800',
  SETTING_UPDATED: 'text-violet-400 bg-violet-900/20',
};

function formatAction(action: string) {
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default function AuditPage() {
  const [data, setData] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await adminAuditApi.list({
        page: p, limit: 30,
        ...(action ? { action } : {}),
      });
      setData(res.data.data);
      setTotal(res.data.total);
      setPages(res.data.pages);
      setPage(p);
    } catch {
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => { load(1); }, [load]);

  function formatMeta(meta: Record<string, unknown> | null) {
    if (!meta) return null;
    const parts: string[] = [];
    if (meta.name) parts.push(`"${meta.name}"`);
    if (meta.email) parts.push(String(meta.email));
    if (meta.reason) parts.push(`Reason: ${meta.reason}`);
    if (meta.fromPlan && meta.toPlan) parts.push(`${meta.fromPlan} → ${meta.toPlan}`);
    if (meta.key) parts.push(`Key: ${meta.key}`);
    return parts.join(' · ') || null;
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Audit log</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} entries. Every admin action is recorded.</p>
        </div>
        <button
          onClick={() => load(page)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-sm transition-colors"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-slate-500"
        >
          <option value="">All actions</option>
          <option value="WORKSPACE_SUSPENDED">Workspace suspended</option>
          <option value="WORKSPACE_REACTIVATED">Workspace reactivated</option>
          <option value="WORKSPACE_DELETED">Workspace deleted</option>
          <option value="WORKSPACE_PLAN_CHANGED">Plan changed</option>
          <option value="USER_SUSPENDED">User suspended</option>
          <option value="USER_REACTIVATED">User reactivated</option>
          <option value="USER_FORCE_LOGOUT">Force logout</option>
          <option value="SETTING_UPDATED">Setting updated</option>
        </select>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-12">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
            Loading log...
          </div>
        ) : data.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">No entries found.</p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {data.map((entry) => (
              <li key={entry.id} className="px-5 py-4 hover:bg-slate-800/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap flex-shrink-0 ${ACTION_COLORS[entry.action] ?? 'text-slate-400 bg-slate-800'}`}>
                      {formatAction(entry.action)}
                    </span>
                    <div className="min-w-0">
                      {formatMeta(entry.metadata) && (
                        <p className="text-sm text-slate-300 truncate">{formatMeta(entry.metadata)}</p>
                      )}
                      {entry.resourceId && (
                        <p className="text-xs text-slate-600 font-mono mt-0.5">{entry.resourceId}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                    {entry.admin && (
                      <p className="text-[11px] text-slate-600 mt-0.5">{entry.admin.email}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <p className="text-xs text-slate-500">Page {page} of {pages}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => load(page - 1)} disabled={page <= 1} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition-colors">
                <ChevronLeft size={15} />
              </button>
              <button onClick={() => load(page + 1)} disabled={page >= pages} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition-colors">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
