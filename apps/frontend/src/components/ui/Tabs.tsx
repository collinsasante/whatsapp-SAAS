'use client';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem { key: string; label: string; count?: number | null }

/** Tab buttons with arrow-key movement. The caller renders the panel; give it role="tabpanel" and aria-labelledby={`${idPrefix}-${key}`}. */
export default function Tabs({ tabs, active, onChange, label, idPrefix }: {
  tabs: TabItem[]; active: string; onChange: (key: string) => void; label: string; idPrefix: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, step: number) => {
    const next = (from + step + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-gray-200">
      {tabs.map((t, i) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key} ref={(el) => { refs.current[i] = el; }} id={`${idPrefix}-${t.key}`} role="tab" type="button"
            aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => onChange(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); }
            }}
            className={cn(
              'px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded-t',
              selected ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-gray-600 hover:text-gray-900',
            )}
          >
            {t.label}
            {t.count != null && <>{' '}<span className={cn('ml-1 text-xs tabular-nums', selected ? 'text-teal-700' : 'text-gray-500')}>{t.count.toLocaleString()}</span></>}
          </button>
        );
      })}
    </div>
  );
}
