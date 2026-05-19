'use client';
import { useEffect, useState, useCallback } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { platformAdminApi, type AuditEntry } from '@/lib/platform-admin-api';
import { formatDistanceToNow } from 'date-fns';

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const LIMIT = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformAdminApi.getAuditLog({ page, limit: LIMIT });
      setEntries(res.data.data);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total.toLocaleString()} entries</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
        <div className="divide-y divide-white/6">
          {loading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex gap-4">
                <div className="w-7 h-7 rounded-lg bg-white/5 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/5 rounded animate-pulse w-1/3" />
                  <div className="h-3 bg-white/5 rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              No audit entries found
            </div>
          ) : entries.map(e => (
            <div key={e.id} className="px-5 py-4 flex items-start gap-4 hover:bg-white/[0.02] transition-colors">
              <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 flex-shrink-0 mt-0.5">
                <FileText size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-white text-sm font-medium">{e.action}</span>
                  <span className="text-slate-600 text-xs">{e.targetType} · {e.targetId.slice(0, 8)}…</span>
                </div>
                <p className="text-slate-500 text-xs mt-0.5">
                  by {e.admin?.email ?? e.adminId.slice(0, 8)}
                </p>
              </div>
              <span className="text-slate-600 text-xs flex-shrink-0">
                {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/8">
            <p className="text-slate-500 text-xs">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">Prev</button>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
