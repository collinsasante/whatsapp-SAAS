import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2, AlertCircle } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/modern-ui/table';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

/**
 * Every major admin table needs the same states (loading/error/empty) and the
 * same sort-header interaction -- built once on top of the already-present
 * but previously-unused modern-ui/table.tsx primitives instead of every page
 * hand-rolling a raw <table>.
 */
export function DataTable<T>({
  columns, rows, getRowKey, loading, error, emptyMessage = 'No results',
  sortKey, sortOrder, onSortChange, onRowClick, selectedRowKey,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className={cn(col.sortable && 'cursor-pointer select-none hover:text-gray-600', col.className)}
              onClick={col.sortable && onSortChange ? () => onSortChange(col.key) : undefined}
            >
              <span className="inline-flex items-center gap-1">
                {col.header}
                {col.sortable && (
                  sortKey === col.key
                    ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-30" />
                )}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={columns.length} className="text-center py-10 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading…
          </TableCell></TableRow>
        ) : error ? (
          <TableRow><TableCell colSpan={columns.length} className="text-center py-10 text-red-500">
            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
            {error}
          </TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={columns.length} className="text-center py-10 text-gray-400">{emptyMessage}</TableCell></TableRow>
        ) : (
          rows.map((row) => {
            const key = getRowKey(row);
            return (
              <TableRow
                key={key}
                data-selected={selectedRowKey === key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : undefined}
              >
                {columns.map((col) => <TableCell key={col.key} className={col.className}>{col.render(row)}</TableCell>)}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
