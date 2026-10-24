'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  /** What will happen, in plain words. */
  description: React.ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** Ask why. The answer is passed to onConfirm and recorded in the audit trail. */
  reason?: { label: string; minLength?: number; required?: boolean };
  /** Make the person type this exact text before the button turns on, for actions that are hard to undo. */
  typeToConfirm?: string;
  /** Context shown above the form: current value, proposed value, resulting balance. */
  details?: React.ReactNode;
  /** Extra form fields (an amount, a plan picker). Their state lives in the caller. */
  children?: React.ReactNode;
  /** Keeps the confirm button off until the caller's own fields are valid. */
  submitDisabled?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Confirmation for anything privileged. It names the action, can require a reason or a typed confirmation, keeps the
 * dialog open and shows the real error if the server refuses, and only closes after the server says it worked.
 */
export function ActionDialog({ open, title, description, confirmLabel, tone = 'default', reason, typeToConfirm, details, children, submitDisabled, onConfirm, onClose }: Props) {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setText(''); setTyped(''); setError(null); setPending(false);
    const first = panel.current?.querySelector<HTMLElement>('textarea, input, button');
    first?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) { onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button, textarea, input, [href]')].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  const minLength = reason?.minLength ?? 3;
  const reasonOk = !reason || (!reason.required && text.trim() === '') || text.trim().length >= minLength;
  const typedOk = !typeToConfirm || typed === typeToConfirm;
  const ready = reasonOk && typedOk && !pending && !submitDisabled;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setPending(true); setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change was not made.');
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !pending && onClose()} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="relative w-full sm:max-w-md bg-white rounded-t-xl sm:rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex gap-3">
            {tone === 'danger' && <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-red-50 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" /></span>}
            <div>
              <h2 id={`${id}-t`} className="text-base font-semibold text-gray-900">{title}</h2>
              <div id={`${id}-d`} className="text-sm text-gray-600 mt-1">{description}</div>
            </div>
          </div>

          {details && <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm">{details}</div>}

          {children}

          {reason && (
            <div>
              <label htmlFor={`${id}-r`} className="block text-sm font-medium text-gray-800 mb-1">
                {reason.label}{reason.required === false ? ' (optional)' : ''}
              </label>
              <textarea
                id={`${id}-r`} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <p className="text-xs text-gray-500 mt-1">Saved in the audit trail with your name.</p>
            </div>
          )}

          {typeToConfirm && (
            <div>
              <label htmlFor={`${id}-c`} className="block text-sm font-medium text-gray-800 mb-1">Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm</label>
              <input id={`${id}-c`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600" />
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={pending} className="px-3.5 py-2 text-sm font-medium text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button
              type="submit" disabled={!ready}
              className={cn('inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed', tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700')}
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
