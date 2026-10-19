import type { CallStartError } from '@/lib/call-client';

/** Explains why a call could not start, with steps when there is something the person can do. */
export function CallStartErrorNotice({ error, onDismiss }: { error: CallStartError; onDismiss?: () => void }) {
  const status = error.callingStatus;
  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-amber-900">{error.message}</p>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900 text-sm leading-none px-1">x</button>
        )}
      </div>
      {status && status.checked && status.state !== 'UNKNOWN' && (
        <p className="mt-1 text-xs text-amber-800">Meta reports calling as {status.state === 'ENABLED' ? 'enabled' : 'disabled'} for this number.</p>
      )}
      {error.steps.length > 0 && (
        <ol className="mt-2 list-decimal pl-4 space-y-1 text-xs text-amber-900">
          {error.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
    </div>
  );
}
