'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Building2, User, ShoppingCart, CreditCard, Loader2 } from 'lucide-react';
import { adminApi, type SearchResults } from '@/lib/admin-api';

const EMPTY: SearchResults = { tenants: [], users: [], orders: [], payments: [] };

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(EMPTY);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      adminApi.search(query.trim())
        .then((r) => setResults(r))
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const hasResults = results.tenants.length || results.users.length || results.orders.length || results.payments.length;

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search tenants, users, orders, payments…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
        />
        {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg max-h-96 overflow-auto">
          {!loading && !hasResults && <div className="p-4 text-sm text-gray-400 text-center">No results</div>}

          {results.tenants.length > 0 && (
            <SearchGroup icon={Building2} label="Tenants">
              {results.tenants.map((t) => (
                <SearchRow key={t.id} onClick={() => go(`/platform-admin/workspaces/${t.id}`)}>{t.name}</SearchRow>
              ))}
            </SearchGroup>
          )}

          {results.users.length > 0 && (
            <SearchGroup icon={User} label="Users">
              {results.users.map((u) => (
                <SearchRow key={u.id} onClick={() => go(`/platform-admin/workspaces/${u.tenantId}`)}>
                  {u.name ?? u.email} <span className="text-gray-400">· {u.email}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}

          {results.orders.length > 0 && (
            <SearchGroup icon={ShoppingCart} label="Orders">
              {results.orders.map((o) => (
                <SearchRow key={o.id} onClick={() => go(`/platform-admin/orders/${o.id}`)}>
                  {o.customerName ?? o.customerPhone} <span className="text-gray-400">· {o.currency} {o.totalMajorUnits}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}

          {results.payments.length > 0 && (
            <SearchGroup icon={CreditCard} label="Payments">
              {results.payments.map((p) => (
                <SearchRow key={p.id} onClick={() => go(`/platform-admin/payments?search=${encodeURIComponent(p.gatewayReference ?? p.id)}`)}>
                  {p.gatewayReference ?? p.gatewayPaymentId ?? p.id} <span className="text-gray-400">· {p.currency} {p.amount}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {label}
      </div>
      {children}
    </div>
  );
}

function SearchRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 truncate">
      {children}
    </button>
  );
}
