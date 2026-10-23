'use client';
import { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDebounced } from '@/lib/admin/hooks';

export interface SelectFilter {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

/**
 * Search plus dropdown filters. The search text is sent to the server once the person pauses typing, and "Clear" puts
 * every filter back, so an empty table is never a dead end.
 */
export function FilterBar({ search, onSearch, placeholder = 'Search', filters = [], onClear, extra }: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  filters?: SelectFilter[];
  onClear?: () => void;
  extra?: React.ReactNode;
}) {
  const [text, setText] = useState(search);
  const debounced = useDebounced(text, 350);
  const id = useId();

  useEffect(() => { setText(search); }, [search]);
  useEffect(() => { if (debounced !== search) onSearch(debounced); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = filters.filter((f) => f.value !== '').length + (search ? 1 : 0);

  return (
    <div role="search" className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative w-full sm:w-72">
        <label htmlFor={`${id}-q`} className="sr-only">{placeholder}</label>
        <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          id={`${id}-q`} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
        />
      </div>
      {filters.map((f) => (
        <div key={f.key}>
          <label htmlFor={`${id}-${f.key}`} className="sr-only">{f.label}</label>
          <select
            id={`${id}-${f.key}`} value={f.value} onChange={(e) => f.onChange(e.target.value)}
            className="py-2 pl-2.5 pr-7 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
      {extra}
      {active > 0 && onClear && (
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
          <X className="w-3.5 h-3.5" aria-hidden="true" />Clear {active > 1 ? `${active} filters` : 'filter'}
        </button>
      )}
    </div>
  );
}
