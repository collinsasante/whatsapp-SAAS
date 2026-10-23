'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, OctagonAlert } from 'lucide-react';
import type { AttentionData } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/admin/format';
import { ErrorState, Skeleton } from './States';

export function AttentionPanel({ data, loading, error, onRetry }: { data: AttentionData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const [showChecks, setShowChecks] = useState(false);

  if (error && !data) return <div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={error} onRetry={onRetry} /></div>;
  if (!data) return <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;

  const clearCount = data.checks.filter((c) => c.clear).length;

  return (
    <div className={cn('rounded-lg border bg-white overflow-hidden', data.items.length > 0 ? 'border-amber-300' : 'border-gray-200', loading && 'opacity-70')}>
      {data.items.length === 0 ? (
        <div className="flex items-start gap-3 p-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-gray-900">Nothing needs attention right now</p>
            <p className="text-sm text-gray-600">All {data.checks.length} checks came back clear. That covers only what is listed below, not everything that could go wrong.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.items.map((item) => {
            const Icon = item.severity === 'critical' ? OctagonAlert : AlertTriangle;
            return (
              <li key={item.id}>
                <Link href={item.href} className="group flex items-start gap-3 p-3.5 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600">
                  <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', item.severity === 'critical' ? 'text-rose-600' : 'text-amber-600')} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{item.title}</span>
                      <span className={cn('text-xs font-medium', item.severity === 'critical' ? 'text-rose-700' : 'text-amber-800')}>{item.severity === 'critical' ? 'Critical' : 'Warning'}</span>
                    </span>
                    <span className="block text-sm text-gray-600 mt-0.5">{item.detail}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 mt-1 text-gray-400 group-hover:text-teal-700 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-gray-100 bg-gray-50/70 px-3.5 py-2">
        <button type="button" onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showChecks && 'rotate-180')} aria-hidden="true" />
          {clearCount} of {data.checks.length} checks clear · checked {formatRelative(data.checkedAt)}
        </button>
        {showChecks && (
          <div className="mt-2 text-xs text-gray-600">
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {data.checks.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5">
                  {c.clear ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />}
                  <span>{c.label}<span className="sr-only">{c.clear ? ': clear' : ': needs attention'}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-2"><span className="font-medium text-gray-700">Not checked here:</span> {data.notChecked.join('; ')}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
