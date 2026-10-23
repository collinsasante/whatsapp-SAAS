'use client';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Widget } from '@/lib/dashboard/useWidget';
import { Skeleton } from '@/components/analytics/ui';

/**
 * Frame for one dashboard widget. It owns the loading, error and retry states so each widget fails on its own:
 * a broken query shows an inline message with a retry button while the rest of the page keeps working.
 */
export default function WidgetCard<T>({ id, title, description, aside, widget, skeletonClassName = 'h-40', className, children }: {
  id: string;
  title: string;
  description?: string;
  aside?: React.ReactNode;
  widget: Widget<T>;
  skeletonClassName?: string;
  className?: string;
  children: (data: T) => React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  const { data, loading, error, reload } = widget;
  return (
    <section id={id} aria-labelledby={headingId} aria-busy={loading} className={cn('bg-white border border-gray-200 rounded-xl p-4 sm:p-5 scroll-mt-24', className)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-gray-900">{title}</h2>
          {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
        </div>
        {aside}
      </div>
      {data ? (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          {children(data)}
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              Could not refresh this section. {error}{' '}
              <button onClick={reload} className="font-medium underline hover:no-underline">Try again</button>
            </p>
          )}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-rose-50/60 border border-rose-100 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <AlertCircle size={16} className="text-rose-500" aria-hidden="true" />This section could not be loaded
          </p>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={reload}
            className="px-3 py-1.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            Try again
          </button>
        </div>
      ) : (
        <Skeleton className={skeletonClassName} />
      )}
    </section>
  );
}
