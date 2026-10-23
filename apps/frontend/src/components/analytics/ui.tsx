'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compare, type Delta, type Direction } from '@/lib/analytics/format';
import { KIND_LABEL, type MetricDefinition } from '@/lib/analytics/metrics';

/** A titled block of the page. The heading is a question so each section answers something. */
export function Section({ id, question, description, children, aside }: {
  id: string; question: string; description?: string; children: React.ReactNode; aside?: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">{question}</h2>
          {description && <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Panel({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={cn('bg-white border border-gray-200 rounded-xl', className)}>
      {children}
    </div>
  );
}

export function PanelTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
      {aside}
    </div>
  );
}

/** An explanation that opens on hover, focus or tap, and closes with Escape. */
export function InfoTip({ definition }: { definition: MetricDefinition }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`What ${definition.label} means`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-gray-400 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-64 max-w-[80vw] rounded-lg bg-gray-900 text-white text-xs leading-relaxed p-3 shadow-lg text-left font-normal normal-case"
        >
          <span className="block font-semibold mb-1">{definition.label}</span>
          <span className="block">{definition.meaning}</span>
          <span className="block mt-1.5 text-gray-300">{definition.calculation}</span>
          <span className="block mt-1.5 text-gray-400">{KIND_LABEL[definition.kind]} number</span>
        </span>
      )}
    </span>
  );
}

/**
 * Change against the previous period. The words say what happened and whether it is good; the arrow and colour only
 * repeat it. "Better" and "worse" depend on the metric: slower replies going up is worse.
 */
export function DeltaBadge({ current, previous, direction, className }: {
  current: number | null; previous: number | null; direction: Direction; className?: string;
}) {
  const delta = compare(current, previous, direction);
  return <DeltaView delta={delta} className={className} />;
}

export function DeltaView({ delta, className }: { delta: Delta; className?: string }) {
  const tone = delta.verdict === 'better' ? 'text-teal-700' : delta.verdict === 'worse' ? 'text-rose-700' : 'text-gray-500';
  const Icon = delta.ratio == null || delta.ratio === 0 ? Minus : delta.ratio > 0 ? ArrowUpRight : ArrowDownRight;
  const judged = delta.verdict === 'better' || delta.verdict === 'worse';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', tone, className)}>
      <Icon size={12} aria-hidden="true" />
      <span>{delta.label}</span>
      {judged && <span className="font-normal">, {delta.verdict}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-gray-100 rounded-lg animate-pulse', className)} />;
}

export function EmptyNote({ title, children, href, hrefLabel }: { title: string; children?: React.ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-4 py-5 text-sm">
      <p className="font-medium text-gray-800">{title}</p>
      {children && <p className="text-gray-500 mt-1 max-w-xl">{children}</p>}
      {href && hrefLabel && (
        <Link href={href} className="inline-block mt-2 text-teal-700 font-medium hover:underline">{hrefLabel}</Link>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center gap-3 py-16 bg-white border border-gray-200 rounded-xl">
      <AlertCircle size={28} className="text-rose-400" aria-hidden="true" />
      <div>
        <p className="font-medium text-gray-900">Analytics could not be loaded</p>
        <p className="text-sm text-gray-500 mt-0.5">{message}</p>
      </div>
      <button onClick={onRetry} className="px-3.5 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
        Try again
      </button>
    </div>
  );
}

/** Horizontal bar with the value written next to it, for rankings. The number is text, so no chart library is needed. */
export function BarRow({ label, value, max, suffix, tone = 'bg-teal-600', sub }: {
  label: string; value: number; max: number; suffix?: React.ReactNode; tone?: string; sub?: React.ReactNode;
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 py-1.5">
      <span className="text-sm text-gray-700 truncate" title={label}>{label}</span>
      <span className="h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${width}%` }} />
      </span>
      <span className="text-sm font-medium text-gray-900 tabular-nums text-right whitespace-nowrap">
        {value.toLocaleString()}{suffix}
        {sub && <span className="block text-xs font-normal text-gray-500">{sub}</span>}
      </span>
    </li>
  );
}
