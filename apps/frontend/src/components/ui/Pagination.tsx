'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "21-40 of 134" with Previous and Next. Renders nothing when everything fits on one page. */
export default function Pagination({ page, pageSize, total, onChange, noun }: {
  page: number; pageSize: number; total: number; onChange: (page: number) => void; noun: string;
}) {
  const pages = pageCount(total, pageSize);
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label={`${noun} pages`} className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 text-sm">
      <p className="text-gray-600" aria-live="polite">{first.toLocaleString()} to {last.toLocaleString()} of {total.toLocaleString()} {noun}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={14} aria-hidden="true" />Previous</Button>
        <span className="text-gray-500 tabular-nums hidden sm:inline">Page {page} of {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next<ChevronRight size={14} aria-hidden="true" /></Button>
      </div>
    </nav>
  );
}
