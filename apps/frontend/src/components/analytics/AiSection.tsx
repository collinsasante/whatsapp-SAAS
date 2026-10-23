'use client';
import Link from 'next/link';
import { formatNumber, formatShare } from '@/lib/analytics/format';
import { METRICS } from '@/lib/analytics/metrics';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { DeltaBadge, EmptyNote, InfoTip, Panel, PanelTitle } from './ui';
import type { MetricKey } from '@/lib/analytics/metrics';

function Stat({ metric, value, detail }: { metric: MetricKey; value: React.ReactNode; detail: React.ReactNode }) {
  const def = METRICS[metric];
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">{def.label}<InfoTip definition={def} /></dt>
      <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{value}</dd>
      <dd className="text-xs text-gray-500 mt-1">{detail}</dd>
    </div>
  );
}

export default function AiSection({ data }: { data: IntelligenceResponse }) {
  const { current: c, previous: p } = data;
  const ai = c.ai;

  if (!data.coverage.ai) {
    return (
      <EmptyNote title="Verz AI has not been used yet" href="/ai" hrefLabel="Open Verz AI">
        Once Verz AI suggests or sends a reply, this section shows how often it answers, how often agents accept its suggestions, and how often a person has to step in.
      </EmptyNote>
    );
  }

  const handoffRate = ai.engagedConversations > 0 ? ai.handedToPerson / ai.engagedConversations : null;
  const prevHandoff = p.ai.engagedConversations > 0 ? p.ai.handedToPerson / p.ai.engagedConversations : null;
  const used = ai.suggestionsSent;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Panel className="p-5 lg:col-span-3">
        <PanelTitle>What Verz AI handled</PanelTitle>
        {ai.engagedConversations === 0 ? (
          <EmptyNote title="No Verz AI activity in this period" />
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
            <Stat
              metric="aiEngaged" value={formatNumber(ai.engagedConversations)}
              detail={<DeltaBadge current={ai.engagedConversations} previous={p.ai.engagedConversations} direction="neutral" />}
            />
            <Stat
              metric="aiHandoff" value={handoffRate == null ? 'n/a' : `${Math.round(handoffRate * 100)}%`}
              detail={<span>{ai.handedToPerson} of {ai.engagedConversations}. <DeltaBadge current={handoffRate} previous={prevHandoff} direction="lower-is-better" className="ml-1" /></span>}
            />
            <Stat
              metric="aiResolved" value={formatNumber(ai.resolvedWithoutPerson)}
              detail={`${formatShare(ai.resolvedWithoutPerson, c.resolved)} of the ${c.resolved} resolved`}
            />
          </dl>
        )}
        <p className="text-xs text-gray-500 mt-5 pt-4 border-t border-gray-100">
          Verz AI taking part in a conversation is not the same as resolving it. A conversation only counts as resolved without a person when it was resolved, Verz AI replied automatically, and nobody on the team sent a message.
        </p>
      </Panel>

      <Panel className="p-5 lg:col-span-2">
        <PanelTitle>Suggestions to agents</PanelTitle>
        {ai.suggestions === 0 ? (
          <p className="text-sm text-gray-500">No suggestions were made in this period.{ai.autoReplies > 0 && ` Verz AI sent ${ai.autoReplies} automatic ${ai.autoReplies === 1 ? 'reply' : 'replies'} instead.`}</p>
        ) : (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
              <div className="bg-teal-600" style={{ width: `${((used - ai.suggestionsEdited) / ai.suggestions) * 100}%` }} />
              <div className="bg-sky-500" style={{ width: `${(ai.suggestionsEdited / ai.suggestions) * 100}%` }} />
              <div className="bg-slate-300" style={{ width: `${(ai.suggestionsRejected / ai.suggestions) * 100}%` }} />
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-teal-600" />Sent as written</dt><dd className="tabular-nums">{used - ai.suggestionsEdited}</dd></div>
              <div className="flex justify-between"><dt className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-sky-500" />Edited, then sent</dt><dd className="tabular-nums">{ai.suggestionsEdited}</dd></div>
              <div className="flex justify-between"><dt className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-slate-300" />Rejected</dt><dd className="tabular-nums">{ai.suggestionsRejected}</dd></div>
              <div className="flex justify-between text-gray-500"><dt>Not acted on yet</dt><dd className="tabular-nums">{ai.suggestions - used - ai.suggestionsRejected}</dd></div>
            </dl>
          </>
        )}
        <dl className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-gray-100 text-sm">
          <div><dt className="text-xs text-gray-500">Automatic replies</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(ai.autoReplies)}</dd></div>
          <div><dt className="text-xs text-gray-500">Verz AI credits used</dt><dd className="text-lg font-semibold tabular-nums">{ai.creditsUsed == null ? 'n/a' : formatNumber(ai.creditsUsed)}</dd>{ai.creditsUsed == null && <dd className="text-xs text-gray-500">Credits are not split by channel</dd>}</div>
        </dl>
        <p className="text-xs text-gray-500 mt-4">
          Automation rules do not keep a run history, so how often they succeed or fail cannot be shown here. <Link href="/automation" className="text-teal-700 hover:underline">Open automations</Link>
        </p>
      </Panel>
    </div>
  );
}
