'use client';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, Skeleton } from './States';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Sort by this column. The page decides what sorting means; the table only reports the click. */
  sortable?: boolean;
  /** How the column appears in the stacked layout used on narrow screens. Columns left out are not shown there. */
  mobile?: 'title' | 'line' | 'badge';
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Where a row leads. The row's first cell becomes a real link, so it works with the keyboard and a new tab. */
  rowHref?: (row: T) => string;
  caption: string;
}

/**
 * One table for every list: loading skeleton, error with retry, an empty state, sortable headers that announce their
 * order, and a stacked card layout on narrow screens instead of a table that scrolls sideways.
 */
export function AdminTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, sortKey, sortOrder, onSort, rowHref, caption }: Props<T>) {
  if (error && rows.length === 0) return <div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={error} onRetry={onRetry} /></div>;
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2" aria-busy="true" aria-label={`Loading ${caption}`}>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (rows.length === 0) return <div className="rounded-lg border border-gray-200 bg-white">{empty ?? <EmptyState title="Nothing to show" />}</div>;

  const title = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const badges = columns.filter((c) => c.mobile === 'badge');
  const lines = columns.filter((c) => c.mobile === 'line');

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white overflow-hidden transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
      {error && <p role="alert" className="px-3 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">Showing the last results. Refreshing failed: {error}</p>}

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
              {columns.map((c) => (
                <th
                  key={c.key} scope="col" className={cn('px-3 py-2 font-medium', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
                  aria-sort={c.sortable ? (sortKey === c.key ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                >
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-900 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
                      {c.header}
                      {sortKey === c.key ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />) : <ChevronsUpDown className="w-3 h-3 text-gray-300" aria-hidden="true" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-gray-50">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn('px-3 py-2.5 align-middle', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                    {i === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium text-gray-900 hover:text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">{c.cell(row)}</Link>
                    ) : c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-gray-100" aria-label={caption}>
        {rows.map((row) => {
          const heading = rowHref ? <Link href={rowHref(row)} className="font-medium text-gray-900 hover:underline">{title.cell(row)}</Link> : <span className="font-medium text-gray-900">{title.cell(row)}</span>;
          return (
            <li key={rowKey(row)} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm">{heading}</div>
                {badges.length > 0 && <div className="flex flex-wrap justify-end gap-1">{badges.map((b) => <span key={b.key}>{b.cell(row)}</span>)}</div>}
              </div>
              {lines.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {lines.map((l) => (
                    <div key={l.key} className="min-w-0">
                      <dt className="text-gray-500">{l.header}</dt>
                      <dd className="text-gray-800 truncate">{l.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
