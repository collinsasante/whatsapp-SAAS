'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The record's identifier, with a button to copy it. Support asks for these constantly. */
export function CopyId({ value, label = 'ID' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the id stays selectable */ }
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span>{label}</span>
      <code className="font-mono text-gray-700 select-all break-all">{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
        {copied ? <Check className="w-3.5 h-3.5 text-green-600" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
        <span className="sr-only" role="status">{copied ? 'Copied' : ''}</span>
      </button>
    </span>
  );
}

/** Label and value pairs, in a grid that stacks on narrow screens. */
export function Facts({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-gray-500">{i.label}</dt>
          <dd className="text-gray-900 break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TabDef { key: string; label: string; count?: number }

/** Tabs that live in the address (?tab=), so a link to one opens that tab. Arrow keys move between them. */
export function Tabs({ tabs, active, onChange, label }: { tabs: TabDef[]; active: string; onChange: (key: string) => void; label: string }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
      {tabs.map((t, i) => (
        <button
          key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={active === t.key} aria-controls={`panel-${t.key}`} tabIndex={active === t.key ? 0 : -1}
          onClick={() => onChange(t.key)} onKeyDown={(e) => move(e, i)}
          className={cn('px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
            active === t.key ? 'border-teal-600 text-teal-800 font-medium' : 'border-transparent text-gray-600 hover:text-gray-900')}
        >
          {t.label}{t.count != null && <span className="ml-1.5 text-xs text-gray-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
