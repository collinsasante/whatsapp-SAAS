'use client';
import { useId } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export const inputClasses =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-teal-600 disabled:bg-gray-50 disabled:text-gray-500';

/** A labelled form control. The label is always visible, and hint or error text is tied to the control for screen readers. */
export function Field({ label, hint, error, children, className }: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children({ id, 'aria-describedby': note ? noteId : undefined, 'aria-invalid': error ? true : undefined })}
      {note && <p id={noteId} className={cn('text-xs mt-1', error ? 'text-red-700' : 'text-gray-500')}>{note}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, label, className }: {
  value: string; onChange: (value: string) => void; placeholder: string; label: string; className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className={cn(inputClasses, 'pl-9')}
      />
    </div>
  );
}

export function SelectInput({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClasses, 'pr-8', className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
