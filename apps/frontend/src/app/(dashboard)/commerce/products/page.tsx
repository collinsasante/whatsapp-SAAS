'use client';
import { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { commerceProductsApi } from '@/lib/api';
import { useWidget } from '@/lib/dashboard/useWidget';
import { useAuthStore } from '@/store/auth.store';
import { getPermissions } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import StatStrip from '@/components/ui/StatStrip';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import { SearchInput, SelectInput } from '@/components/ui/fields';
import ProductPanel, { ProductThumb } from '@/components/commerce/ProductPanel';
import { formatMoney, LOW_STOCK_AT, STOCK_LABEL, stockState } from '@/lib/commerce/format';
import type { Product } from '@/lib/commerce/types';

const PAGE_SIZE = 20;

type View = 'all' | 'active' | 'inactive' | 'out' | 'low';
type Sort = 'newest' | 'name' | 'priceAsc' | 'priceDesc' | 'stockAsc';

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All products' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
  { value: 'out', label: 'Out of stock' }, { value: 'low', label: 'Low stock' },
];
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'newest', label: 'Newest first' }, { value: 'name', label: 'Name A to Z' }, { value: 'priceAsc', label: 'Price, low to high' },
  { value: 'priceDesc', label: 'Price, high to low' }, { value: 'stockAsc', label: 'Stock, fewest first' },
];

function matches(p: Product, view: View): boolean {
  if (view === 'active') return p.isActive;
  if (view === 'inactive') return !p.isActive;
  // Stock alerts only concern products customers can still buy.
  if (view === 'out') return p.isActive && stockState(p) === 'out';
  if (view === 'low') return p.isActive && stockState(p) === 'low';
  return true;
}

function compare(sort: Sort): (a: Product, b: Product) => number {
  switch (sort) {
    case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'priceAsc': return (a, b) => a.priceMajorUnits - b.priceMajorUnits;
    case 'priceDesc': return (a, b) => b.priceMajorUnits - a.priceMajorUnits;
    // A product with no stock tracking has no count, so it sorts last.
    case 'stockAsc': return (a, b) => (a.stockQuantity ?? Infinity) - (b.stockQuantity ?? Infinity);
    default: return (a, b) => b.createdAt.localeCompare(a.createdAt);
  }
}

export default function ProductsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = getPermissions(role).showCommerce;
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<{ product: Product | null; creating: boolean } | null>(null);

  const products = useWidget<Product[]>('products', async (signal) => (await commerceProductsApi.list(signal)).data as Product[]);
  const all = useMemo(() => products.data ?? [], [products.data]);

  const counts = useMemo(() => ({
    total: all.length,
    active: all.filter((p) => p.isActive).length,
    out: all.filter((p) => matches(p, 'out')).length,
    low: all.filter((p) => matches(p, 'low')).length,
  }), [all]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => matches(p, view) && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)))
      .sort(compare(sort));
  }, [all, query, view, sort]);

  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const defaultCurrency = all[0]?.currency ?? 'GHS';
  const filtering = view !== 'all' || query.trim() !== '';
  const pick = (v: View) => { setView(v); setPage(1); };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <PageHeader
          title="Products"
          description="Everything you sell. Customers are only offered active products."
          actions={
            <>
              <Button variant="secondary" onClick={products.reload} disabled={products.loading} aria-label="Refresh products">
                <RefreshCw size={14} aria-hidden="true" className={cn(products.loading && 'animate-spin')} />Refresh
              </Button>
              {canEdit && <Button onClick={() => setPanel({ product: null, creating: true })}><Plus size={14} aria-hidden="true" />Add product</Button>}
            </>
          }
        />

        {products.data && (
          <StatStrip label="Product summary" stats={[
            { label: 'Total products', value: counts.total.toLocaleString(), onSelect: () => pick('all') },
            { label: 'Active', value: counts.active.toLocaleString(), hint: `${(counts.total - counts.active).toLocaleString()} inactive`, onSelect: () => pick('active'), selected: view === 'active' },
            { label: 'Out of stock', value: counts.out.toLocaleString(), tone: counts.out > 0 ? 'bad' : 'default', hint: 'Active products with none left', onSelect: () => pick('out'), selected: view === 'out' },
            { label: 'Low stock', value: counts.low.toLocaleString(), tone: counts.low > 0 ? 'warn' : 'default', hint: `${LOW_STOCK_AT} or fewer left`, onSelect: () => pick('low'), selected: view === 'low' },
          ]} />
        )}

        <section aria-label="Product list" className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-gray-200 p-3 sm:flex-row sm:items-center">
            <SearchInput label="Search products" placeholder="Search by name or SKU" value={query} onChange={(v) => { setQuery(v); setPage(1); }} className="sm:flex-1" />
            <SelectInput label="Show" value={view} onChange={(v) => pick(v as View)} options={VIEWS} className="sm:w-44" />
            <SelectInput label="Sort by" value={sort} onChange={(v) => { setSort(v as Sort); setPage(1); }} options={SORTS} className="sm:w-48" />
          </div>

          {products.loading && !products.data ? (
            <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading products">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : products.error && !products.data ? (
            <div role="alert" className="m-4 flex flex-col items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-medium text-gray-900">Products could not be loaded</p>
              <p className="text-sm text-gray-600">{products.error}</p>
              <Button size="sm" onClick={products.reload}>Try again</Button>
            </div>
          ) : all.length === 0 ? (
            <div className="p-4">
              <EmptyState compact={false} title="You have not added any products yet">
                Add what you sell, with a price and optional stock, and customers can be offered it in conversations.
              </EmptyState>
              {canEdit && <div className="mt-3 text-center"><Button onClick={() => setPanel({ product: null, creating: true })}><Plus size={14} aria-hidden="true" />Add your first product</Button></div>}
            </div>
          ) : shown.length === 0 ? (
            <div className="p-4">
              <EmptyState compact={false} title="No products match">Try a different search or show all products.</EmptyState>
              {filtering && <div className="mt-3 text-center"><Button variant="secondary" onClick={() => { setQuery(''); pick('all'); }}>Clear filters</Button></div>}
            </div>
          ) : (
            <>
              {products.error && <p role="alert" className="px-4 pt-3 text-sm text-red-700">Could not refresh the list. {products.error} <button onClick={products.reload} className="font-medium underline">Try again</button></p>}
              <div className={cn('overflow-x-auto', products.loading && 'opacity-60')}>
                <table className="w-full text-sm">
                  <caption className="sr-only">Products, {shown.length} shown</caption>
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Product</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">SKU</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Price</th>
                      <th scope="col" className="px-4 py-2 font-medium">Stock</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageRows.map((p) => {
                      const stock = stockState(p);
                      return (
                        <tr key={p.id} className={cn('hover:bg-gray-50', !p.isActive && 'text-gray-500')}>
                          <td className="px-4 py-2.5">
                            <button type="button" onClick={() => setPanel({ product: p, creating: false })} className="flex w-full min-w-0 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
                              <ProductThumb product={p} className="h-10 w-10 shrink-0 rounded-md" />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-gray-900">{p.name}</span>
                                {p.description && <span className="block max-w-xs truncate text-xs text-gray-500">{p.description}</span>}
                              </span>
                            </button>
                          </td>
                          <td className="hidden px-4 py-2.5 text-gray-600 lg:table-cell">{p.sku ?? <span className="text-gray-400">None</span>}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-900">{formatMoney(p.priceMajorUnits, p.currency)}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="tabular-nums text-gray-900">{p.stockQuantity == null ? 'Not tracked' : p.stockQuantity.toLocaleString()}</span>
                              {(stock === 'out' || stock === 'low') && <StatusBadge tone={STOCK_LABEL[stock].tone}>{STOCK_LABEL[stock].label}</StatusBadge>}
                            </span>
                          </td>
                          <td className="hidden px-4 py-2.5 sm:table-cell"><StatusBadge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</StatusBadge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} noun="products" />
            </>
          )}
        </section>
      </div>

      <ProductPanel
        open={panel != null} product={panel?.product ?? null} creating={panel?.creating ?? false} defaultCurrency={defaultCurrency}
        canEdit={canEdit} onClose={() => setPanel(null)} onSaved={products.reload}
      />
    </div>
  );
}
