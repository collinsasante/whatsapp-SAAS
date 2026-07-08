'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon, CheckCircle2, XCircle, User, Loader2, ArrowUpRight } from 'lucide-react';
import { adminApi, type AdminUser, type TenantTableRow } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  AGENT: 'bg-blue-100 text-blue-700',
  OWNER: 'bg-amber-100 text-amber-700',
};

function WorkspaceUsers({ tenantId }: { tenantId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.users(1, '', tenantId);
      setUsers(res.users);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Fetch once when this workspace's row is expanded (component only mounts then)
  useEffect(() => { void load(); }, [load]);

  const toggleActive = async (user: AdminUser) => {
    setToggling(user.id);
    try {
      const res = await adminApi.toggleUserActive(user.id);
      setUsers(us => us?.map(u => u.id === user.id ? { ...u, isActive: res.isActive } : u) ?? null);
      toast.success(`${user.name ?? user.email} ${res.isActive ? 'activated' : 'deactivated'}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return <div className="px-4 py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>;
  }
  if (!users || users.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-gray-400">No users in this workspace</div>;
  }

  return (
    <div className="bg-gray-50 border-t border-gray-100">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">User</th>
            <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">Role</th>
            <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">Email verified</th>
            <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">Last login</th>
            <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">Joined</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map(user => (
            <tr key={user.id} className="hover:bg-gray-100/60">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{user.name ?? <span className="text-gray-400 italic">No name</span>}</div>
                    <div className="text-xs text-gray-400">{user.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {user.emailVerified
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <XCircle className="w-4 h-4 text-gray-300" />}
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-400">
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-400">
                {new Date(user.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </td>
              <td className="px-4 py-2.5">
                <button
                  onClick={(e) => { e.stopPropagation(); void toggleActive(user); }}
                  disabled={toggling === user.id}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    user.isActive
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  } disabled:opacity-50`}
                >
                  {user.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UsersPage() {
  const [workspaces, setWorkspaces] = useState<TenantTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await adminApi.workspaces({ search: query, sort: 'name', order: 'asc', limit, offset });
      setWorkspaces(res.tenants);
      setTotal(res.total);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, limit, offset]);

  const { secondsAgo, refresh } = useAutoRefresh(load);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setOffset(0); setQuery(search); };
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm mt-1">Grouped by workspace — {total.toLocaleString()} workspaces</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search workspace name, billing email, or a user's email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 transition-colors">Search</button>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Team size</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Plan</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Signed up</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ))
                : workspaces.length === 0
                ? (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No workspaces found</td></tr>
                  )
                : workspaces.map(t => (
                    <Fragment key={t.id}>
                      <tr
                        onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {expanded === t.id ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                            <div>
                              <div className="font-medium text-gray-900">{t.name}</div>
                              <div className="text-xs text-gray-400">{t.billingEmail ?? '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{t.teammateCount}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{t.plan ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/platform-admin/workspaces/${t.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-teal-600"
                          >
                            Full workspace <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                      {expanded === t.id && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <WorkspaceUsers tenantId={t.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setOffset(o => Math.max(0, o - limit))} disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2">Page {currentPage} of {totalPages}</span>
            <button onClick={() => setOffset(o => o + limit)} disabled={currentPage >= totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
