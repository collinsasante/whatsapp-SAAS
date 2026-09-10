import React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-500',
  info: 'bg-blue-100 text-blue-700',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

/**
 * Renders a status string through a caller-supplied `{ key: tone }` map, so each
 * page keeps its own small domain-specific map (order/payment/webhook statuses
 * reuse words like "FAILED"/"PENDING" with different meanings -- a single global
 * map would collide) while the rendering itself (colors, unknown-key fallback) is
 * centralized once instead of copy-pasted per page.
 */
export function StatusBadge({ status, map, className }: { status: string; map: Record<string, BadgeTone>; className?: string }) {
  return <Badge tone={map[status] ?? 'neutral'} className={className}>{status}</Badge>;
}

export function healthScoreTone(score: number): BadgeTone {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}
