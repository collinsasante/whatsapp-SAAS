'use client';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatShare } from '@/lib/analytics/format';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { BarRow, EmptyNote, Panel, PanelTitle } from './ui';

export default function TopicsSection({ data }: { data: IntelligenceResponse }) {
  const { rows, labelledConversations, totalConversations } = data.topics;
  const max = Math.max(0, ...rows.map((r) => r.conversations));

  return (
    <Panel className="p-5">
      <PanelTitle>Most common conversation labels</PanelTitle>
      {rows.length === 0 ? (
        <EmptyNote title="No labelled conversations in this period">
          Topics here come from the labels your team and automations add to conversations. Without labels there is nothing to rank. Adding labels such as "pricing" or "delivery" turns this into a list of what customers ask about most.
        </EmptyNote>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">
            {labelledConversations} of {totalConversations} conversations ({formatShare(labelledConversations, totalConversations)}) carry at least one label. A conversation with several labels is counted under each.
          </p>
          <ul>
            {rows.map((r) => {
              const change = r.conversations - r.previousConversations;
              return (
                <BarRow
                  key={r.label} label={r.label} value={r.conversations} max={max}
                  sub={
                    <span className="inline-flex items-center gap-1.5">
                      {r.unresolved > 0 && <span>{r.unresolved} unresolved</span>}
                      {change !== 0 && (
                        <span className="inline-flex items-center">
                          {change > 0 ? <ArrowUpRight size={11} aria-hidden="true" /> : <ArrowDownRight size={11} aria-hidden="true" />}
                          {change > 0 ? `${change} more` : `${Math.abs(change)} fewer`}<span className="sr-only"> than the previous period</span>
                        </span>
                      )}
                    </span>
                  }
                />
              );
            })}
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            Labels are read as written. Message text is not analysed here, so customer messages are never shown in workspace-wide analytics.
          </p>
        </>
      )}
    </Panel>
  );
}
