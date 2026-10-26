'use client';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Widget } from '@/lib/dashboard/useWidget';
import Skeleton from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { CardHeader } from '@/components/ui/Card';

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
    <section id={id} aria-labelledby={headingId} aria-busy={loading} className={cn('flex flex-col bg-white border border-gray-200 rounded-xl p-4 sm:p-5 scroll-mt-24', className)}>
      <CardHeader id={headingId} title={title} description={description} aside={aside} />
      {data ? (
        <div className={cn('flex-1 transition-opacity', loading && 'opacity-60')}>
          {children(data)}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Could not refresh this section. {error}{' '}
              <button onClick={reload} className="font-medium underline hover:no-underline">Try again</button>
            </p>
          )}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-red-50 border border-red-100 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <AlertCircle size={16} className="text-red-500" aria-hidden="true" />This section could not be loaded
          </p>
          <p className="text-sm text-gray-600">{error}</p>
          <Button size="sm" onClick={reload}>Try again</Button>
        </div>
      ) : (
        <Skeleton className={skeletonClassName} />
      )}
    </section>
  );
}
