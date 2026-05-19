'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, MoreVertical, Ban, CheckCircle, LogOut as ForceLogout, Loader2 } from 'lucide-react';
import { adminUsersApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  tenant: { id: string; name: string; plan: string; isActive: boolean } | null;
}

function ActionMenu({ user, onRefresh }: { user: Member; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setOpen(false);
    setLoading(action);
    try {
      if (action === 'suspend') {
        await adminUsersApi.suspend(user.id);
        toast.success(`${user.email} suspended`);
      } else if (action === 'reactivate') {
        await adminUsersApi.reactivate(user.id);
        toast.success(`${user.email} reactivated`);
      } else if (action === 'forceLogout') {
        await adminUsersApi.forceLogout(user.id);
        toast.success(`${user.email} force logged out`);
        return;
      }
      onRefresh();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 bg-slate-900 border border-slate-700 rounded-xl py-1.5 w-44 shadow-xl shadow-black/40">
            <button
              onClick={() => act('forceLogout')}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <ForceLogout size={13} /> Force logout
            </button>
            {user.isActive ? (
              <button
                onClick={() => act('suspend')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-amber-400 hover:bg-slate-800 transition-colors"
              >
                <Ban size={13} /> Suspend
              </button>
            ) : (
              <button
                onClick={() => act('reactivate')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#25D366] hover:bg-slate-800 transition-colors"
              >
                <CheckCircle size={13} /> Reactivate
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function UsersPage() {
  const [data, setData] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await adminUsersApi.list({
        page: p, limit: 25,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      setData(res.data.data);
      setTotal(res.data.total);
      setPages(res.data.pages);
      setPage(p);
    } catch {
      toast.error('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { load(1); }, [load]);

  function relativeTime(date: string | null) {
    if (!date) return 'Never';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="p-8 max-w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Members</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} total across all workspaces</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(1)}
            className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500 w-64"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-slate-500"
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          onClick={() => load(1)}
          className="px-3 py-1.5 bg-[#25D366] hover:bg-[#1aad57] text-white text-sm font-medium rounded-lg transition-colors"
        >
          Search
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Member</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last login</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last seen</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
                      <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
                      Loading members...
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">No members found.</td>
                </tr>
              ) : data.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400 capitalize">{u.role.toLowerCase()}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.tenant ? (
                      <>
                        <p className="text-xs text-slate-300 font-medium">{u.tenant.name}</p>
                        <p className="text-[11px] text-slate-600 capitalize">{u.tenant.plan}</p>
                      </>
                    ) : (
                      <span className="text-slate-600 text-xs">No workspace</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${u.isActive ? 'text-[#25D366]' : 'text-amber-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-[#25D366]' : 'bg-amber-400'}`} />
                      {u.isActive ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{relativeTime(u.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{relativeTime(u.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    <ActionMenu user={u} onRefresh={() => load(page)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
