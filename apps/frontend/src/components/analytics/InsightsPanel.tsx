'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Lightbulb, MinusCircle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthArea, HealthStatus, Insight, InsightSeverity } from '@/lib/analytics/types';
import { Panel } from './ui';

const SEVERITY: Record<InsightSeverity, { label: string; icon: typeof Info; bar: string; text: string }> = {
  attention: { label: 'Needs attention', icon: AlertTriangle, bar: 'border-l-amber-500', text: 'text-amber-800' },
  opportunity: { label: 'Opportunity', icon: Lightbulb, bar: 'border-l-teal-600', text: 'text-teal-800' },
  info: { label: 'Good to know', icon: Info, bar: 'border-l-gray-300', text: 'text-gray-600' },
};

const VISIBLE_AT_FIRST = 4;

function InsightItem({ insight }: { insight: Insight }) {
  const s = SEVERITY[insight.severity];
  const Icon = s.icon;
  return (
    <li className={cn('border-l-4 pl-4 py-3', s.bar)}>
      <p className={cn('flex items-center gap-1.5 text-xs font-semibold', s.text)}>
        <Icon size={13} aria-hidden="true" />{s.label}
      </p>
      <h3 className="text-sm font-semibold text-gray-900 mt-1">{insight.title}</h3>
      <p className="text-sm text-gray-600 mt-1">{insight.why}</p>
      <ul className="mt-2 space-y-0.5">
        {insight.evidence.map((line) => (
          <li key={line} className="text-sm text-gray-800 tabular-nums">{line}</li>
        ))}
      </ul>
      <p className="text-sm text-gray-900 mt-2">
        <span className="font-semibold">Next step: </span>{insight.action}
      </p>
      {insight.link && (
        <Link href={insight.link.href} className="inline-flex items-center gap-1 mt-1.5 text-sm font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
          {insight.link.label}<ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? insights : insights.slice(0, VISIBLE_AT_FIRST);
  const hidden = insights.length - visible.length;

  if (insights.length === 0) {
    return (
      <Panel className="p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <CheckCircle2 size={16} className="text-teal-600" aria-hidden="true" />Nothing stands out in this period
        </p>
        <p className="text-sm text-gray-500 mt-1 max-w-xl">
          No rule found a change or a backlog worth acting on. Insights appear when there is enough activity to compare, so a quiet period or a new workspace will often show none.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <ul className="divide-y divide-gray-100">
        {visible.map((i) => <InsightItem key={i.id} insight={i} />)}
      </ul>
      {(hidden > 0 || showAll) && insights.length > VISIBLE_AT_FIRST && (
        <button
          type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}
          className="mt-3 text-sm font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded"
        >
          {showAll ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
      <p className="text-xs text-gray-500 mt-4">
        Insights come from fixed rules applied to the numbers on this page. Each one lists the values it is based on, and none is shown unless there are enough conversations to support it.
      </p>
    </Panel>
  );
}

const STATUS: Record<HealthStatus, { label: string; icon: typeof Info; tone: string }> = {
  improving: { label: 'Improving', icon: TrendingUp, tone: 'text-teal-700' },
  stable: { label: 'Stable', icon: CheckCircle2, tone: 'text-gray-700' },
  'needs-attention': { label: 'Needs attention', icon: AlertTriangle, tone: 'text-amber-800' },
  'insufficient-data': { label: 'Not enough data', icon: MinusCircle, tone: 'text-gray-500' },
};

export function HealthSummary({ areas }: { areas: HealthArea[] }) {
  return (
    <Panel className="p-5">
      <ul className="divide-y divide-gray-100">
        {areas.map((a) => {
          const s = STATUS[a.status];
          const Icon = s.icon;
          return (
            <li key={a.key} className="py-2.5 first:pt-0 last:pb-0">
              <details className="group">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
                  <span className="text-sm text-gray-900">{a.label}</span>
                  <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', s.tone)}>
                    <Icon size={14} aria-hidden="true" />{s.label}
                  </span>
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-gray-500">
                  {a.basis.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mt-4">
        A status is only given when both periods have at least 10 samples. A change of 10% or less counts as stable. Open a row to see the rules behind it. This is not a score.
      </p>
    </Panel>
  );
}
