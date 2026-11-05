'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type CodeStatus = 'idle' | 'verifying' | 'success' | 'error';

interface CodeInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Called when the last digit is entered (typing, paste or autofill) and when Enter is pressed on a full code. The caller owns duplicate-submission control. */
  onComplete?: (code: string) => void;
  length?: number;
  status?: CodeStatus;
  /** Show filled tiles as dots (a PIN) instead of digits (a one-time code). */
  mask?: boolean;
  /** Focus on mount and when the tab becomes visible again (never on a timer, never over something the user focused). */
  autoFocus?: boolean;
  /** `one-time-code` lets the operating system offer a code it already received; it never reads messages itself. */
  autoComplete?: 'one-time-code' | 'off';
  'aria-label': string;
  id?: string;
}

export interface CodeInputHandle {
  focus: () => void;
}

/**
 * A fixed-length numeric code. ONE real, transparent input sits over display-only tiles, so the browser and the OS treat it as a single field:
 * one-time-code autofill, paste and the numeric keyboard all work, and a screen reader sees one labelled field. The tiles only draw the state.
 * It ignores input while a verification is running or has succeeded, which is the first line of defence against duplicate submissions.
 */
export const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, length = 6, status = 'idle', mask = false, autoFocus = false, autoComplete = 'one-time-code', id, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = status === 'verifying' || status === 'success';

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  useImperativeHandle(ref, () => ({ focus: focusInput }));

  // Focus when the screen first mounts.
  useEffect(() => {
    if (autoFocus) focusInput();
  }, [autoFocus]);

  // Focus again when the user comes back to the tab, but only if nothing else has focus: never steal it from something they chose.
  useEffect(() => {
    if (!autoFocus) return;
    const nothingFocused = () => !document.activeElement || document.activeElement === document.body;
    const onVisible = () => { if (document.visibilityState === 'visible' && nothingFocused()) focusInput(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [autoFocus]);

  // After an error the code is cleared by the caller; put the cursor back so the user can type again straight away.
  useEffect(() => {
    if (status !== 'error' || !autoFocus) return;
    const t = setTimeout(() => { if (!document.activeElement || document.activeElement === document.body || document.activeElement === inputRef.current) focusInput(); }, 60);
    return () => clearTimeout(t);
  }, [status, autoFocus]);

  const accept = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, length);
    if (next === value) return;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const active = Math.min(value.length, length - 1);
  const focusedRing = status === 'idle' ? 'group-focus-within:ring-2 group-focus-within:ring-teal-600' : '';

  return (
    <div className="group relative mx-auto w-fit" data-status={status}>
      <input
        ref={inputRef}
        id={id}
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        value={value}
        readOnly={locked}
        aria-label={rest['aria-label']}
        aria-invalid={status === 'error'}
        aria-busy={status === 'verifying'}
        onChange={(e) => { if (!locked) accept(e.target.value); }}
        onPaste={(e) => {
          e.preventDefault();
          if (!locked) accept(e.clipboardData.getData('text'));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.length === length && !locked) onComplete?.(value);
        }}
        onFocus={(e) => { const end = e.currentTarget.value.length; e.currentTarget.setSelectionRange(end, end); }}
      />
      <div className="flex items-center justify-center gap-2 sm:gap-2.5" aria-hidden="true">
        {Array.from({ length }, (_, i) => {
          const ch = value[i];
          const filled = ch !== undefined;
          const isActive = status === 'idle' && i === active;
          const tone =
            status === 'error' ? 'bg-red-50 text-red-700 ring-1 ring-red-300'
            : status === 'success' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-400'
            : filled ? 'bg-white text-gray-900 ring-1 ring-gray-300'
            : 'bg-gray-50 text-gray-900 ring-1 ring-gray-200';
          return (
            <div
              key={filled ? `${i}-${ch}` : `${i}-empty`}
              className={[
                'relative flex h-14 w-10 items-center justify-center rounded-xl text-2xl font-semibold tabular-nums sm:w-12',
                'transition-[background-color,box-shadow,color] duration-150',
                tone,
                isActive ? `${focusedRing} bg-white` : '',
                filled && status === 'idle' ? 'code-tile-pop' : '',
                status === 'error' ? 'code-tile-shake' : '',
                status === 'verifying' ? 'code-tile-verifying' : '',
              ].join(' ')}
              style={status === 'verifying' ? { animationDelay: `${i * 70}ms` } : undefined}
            >
              {filled ? (mask ? <span className="block h-2.5 w-2.5 rounded-full bg-current" /> : ch) : isActive ? <span className="code-caret hidden h-6 w-0.5 rounded bg-teal-600 group-focus-within:block" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
