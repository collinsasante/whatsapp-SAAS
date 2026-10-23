'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ArrowRight, Info, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** An explanation that opens on hover, focus or tap, and closes with Escape. */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);
  return (
    <span ref={root} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" aria-label={`About ${label}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="text-gray-400 hover:text-gray-600 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-64 max-w-[80vw] rounded-md bg-gray-900 text-white text-xs leading-relaxed p-2.5 shadow-lg text-left font-normal normal-case">
          {children}
        </span>
      )}
    </span>
  );
}

export interface Metric {
  label: string;
  /** The value, or null when it cannot be calculated. null is shown as "Not available", never as zero. */
  value: string | null;
  hint?: React.ReactNode;
  /** Why the value is missing, shown in place of a number. */
  unavailable?: string;
  /** Change against the previous period, as a ratio (0.12 is up 12%), and whether up is good. */
  change?: { ratio: number | null; upIsGood: boolean | null } | null;
  detail?: React.ReactNode;
  href?: string;
}

function Change({ ratio, upIsGood }: { ratio: number | null; upIsGood: boolean | null }) {
  if (ratio == null) return <span className="text-xs text-gray-500">No earlier figure to compare</span>;
  if (Math.abs(ratio) < 0.005) return <span className="inline-flex items-center gap-0.5 text-xs text-gray-500"><Minus className="w-3 h-3" aria-hidden="true" />No change</span>;
  const up = ratio > 0;
  const good = upIsGood == null ? null : up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', good == null ? 'text-gray-600' : good ? 'text-emerald-700' : 'text-rose-700')}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? 'Up' : 'Down'} {Math.round(Math.abs(ratio) * 1000) / 10}%{good == null ? '' : good ? ', better' : ', worse'}
    </span>
  );
}

/** A row of headline numbers in one bordered band. Each can explain itself and link to where it is managed. */
export function MetricStrip({ metrics, columns = 4 }: { metrics: Metric[]; columns?: 3 | 4 | 5 }) {
  const grid = columns === 5 ? 'lg:grid-cols-5' : columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-200 overflow-hidden">
      <dl className={cn('grid grid-cols-2 gap-px', grid)}>
        {metrics.map((m) => {
          const missing = m.value == null;
          return (
            <div key={m.label} className="bg-white p-3.5 min-w-0">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                <span className="truncate">{m.label}</span>
                {m.hint && <Hint label={m.label}>{m.hint}</Hint>}
                {m.href && (
                  <Link href={m.href} aria-label={`Open ${m.label}`} className="ml-auto text-gray-400 hover:text-teal-700 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                )}
              </dt>
              <dd className={cn('mt-1 tabular-nums tracking-tight font-semibold', missing ? 'text-sm text-gray-500 font-normal' : 'text-2xl text-gray-900')}>
                {missing ? (m.unavailable ?? 'Not available') : m.value}
              </dd>
              <dd className="mt-1 min-h-[1rem] text-xs text-gray-500">
                {m.change !== undefined && m.change !== null && !missing ? <Change {...m.change} /> : m.detail}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
