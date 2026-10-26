import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface Stat {
  label: string;
  value: React.ReactNode;
  /** One short line under the value: what the number means or how it compares. */
  hint?: React.ReactNode;
  /** `warn` tints the value when the number needs attention. */
  tone?: 'default' | 'warn' | 'bad';
  /** Makes the stat a button that applies a filter. */
  onSelect?: () => void;
  selected?: boolean;
  href?: string;
}

const TONE = { default: 'text-gray-900', warn: 'text-amber-700', bad: 'text-red-700' };

function Body({ stat }: { stat: Stat }) {
  return (
    <>
      <span className="block text-sm text-gray-600">{stat.label}</span>
      <span className={cn('block text-2xl font-semibold tabular-nums mt-0.5', TONE[stat.tone ?? 'default'])}>{stat.value}</span>
      {stat.hint && <span className="block text-xs text-gray-500 mt-0.5">{stat.hint}</span>}
    </>
  );
}

/** A compact row of figures that sits above a table. One bordered strip rather than a card per number. */
export default function StatStrip({ stats, label }: { stats: Stat[]; label: string }) {
  const cell = 'px-4 py-3 text-left min-w-0';
  return (
    <dl role="group" aria-label={label} className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
      {stats.map((s) => (
        <div key={s.label} className="bg-white">
          {s.onSelect ? (
            <button type="button" onClick={s.onSelect} aria-pressed={s.selected} className={cn(cell, 'w-full hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-600', s.selected && 'bg-teal-50')}>
              <Body stat={s} />
            </button>
          ) : s.href ? (
            <Link href={s.href} className={cn(cell, 'block hover:bg-gray-50')}><Body stat={s} /></Link>
          ) : (
            <div className={cell}><Body stat={s} /></div>
          )}
        </div>
      ))}
    </dl>
  );
}
