import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'neutral';

/** One colour per meaning across the product. The label always says it in words; colour only repeats it. */
const TONE: Record<StatusTone, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  ai: 'bg-violet-50 text-violet-700 border-violet-200',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
};

export default function StatusBadge({ tone = 'neutral', children, className }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}
