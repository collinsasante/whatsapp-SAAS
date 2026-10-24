import { AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-gray-100 rounded animate-pulse', className)} />;
}

/** Nothing matched. Says what to do next, since an empty table is usually a filter that is too narrow. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-1 py-12 px-4">
      <Inbox className="w-6 h-6 text-gray-300 mb-1" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {children && <p className="text-sm text-gray-500 max-w-md">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center gap-2 py-12 px-4">
      <AlertCircle className="w-6 h-6 text-red-400" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-900">This could not be loaded</p>
      <p className="text-sm text-gray-500 max-w-md">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-1 px-3 py-1.5 text-sm font-medium rounded-md bg-teal-600 text-white hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
          Try again
        </button>
      )}
    </div>
  );
}

/** A section the platform cannot report on, with the reason. Different from an empty result and from zero. */
export function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5">{children}</p>;
}

/** Shown to a viewer, whose role can read everything and change nothing. */
export function ReadOnlyNotice() {
  return (
    <p role="note" className="text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md px-3 py-2 mb-4">
      You have read-only access. You can see everything on this page, but the buttons that change something are turned off for your role.
    </p>
  );
}
