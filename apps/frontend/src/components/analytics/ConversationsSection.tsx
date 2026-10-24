'use client';
import Link from 'next/link';
import { channelName, DAY_NAMES, DAY_SHORT, formatDuration, formatNumber, formatShare, formatWaiting } from '@/lib/analytics/format';
import { METRICS } from '@/lib/analytics/metrics';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { BarRow, DeltaBadge, EmptyNote, InfoTip, Panel, PanelTitle } from './ui';

function Waiting({ data }: { data: IntelligenceResponse }) {
  const b = data.backlog;
  const stats = [
    { label: 'Open', value: b.open },
    { label: 'No owner', value: b.unassigned },
    { label: 'Waiting on you', value: b.awaitingReply },
    { label: 'Waiting over an hour', value: b.awaitingReplyOverHour },
  ];
  return (
    <Panel className="p-5">
      <PanelTitle aside={<Link href="/inbox" className="text-xs font-medium text-teal-700 hover:underline">Open the inbox</Link>}>
        Waiting right now
      </PanelTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-gray-500">{s.label}</dt>
            <dd className="text-xl font-semibold text-gray-900 tabular-nums">{formatNumber(s.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-gray-500 mt-2">A snapshot of this moment, not the selected period. {b.slaBreached > 0 && `${b.slaBreached} open ${b.slaBreached === 1 ? 'conversation has' : 'conversations have'} passed a response deadline.`}</p>

      <h4 className="text-sm font-semibold text-gray-900 mt-5 mb-1">Waiting longest</h4>
      {b.waiting.length === 0 ? (
        <p className="text-sm text-gray-500">No customer is waiting for a reply.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {b.waiting.map((w) => (
            <li key={w.conversationId}>
              <Link
                href={`/inbox?c=${w.conversationId}`}
                className="flex items-center justify-between gap-3 py-2 text-sm rounded hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900 truncate">{w.contactName ?? 'Unknown contact'}</span>
                  <span className="block text-xs text-gray-500 truncate">{channelName(w.channel)} · {w.assignedTo ? `with ${w.assignedTo}` : 'no owner'}</span>
                </span>
                <span className="text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">{formatWaiting(w.waitingSeconds)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Speed({ data }: { data: IntelligenceResponse }) {
  const { current: c, previous: p } = data;
  const fr = c.firstResponse;
  const maxBucket = Math.max(0, ...fr.buckets.map((b) => b.count));
  const slaMet = c.sla.tracked > 0 ? c.sla.tracked - c.sla.breached : null;

  return (
    <Panel className="p-5">
      <PanelTitle>How fast you answer</PanelTitle>
      {fr.samples === 0 ? (
        <EmptyNote title="No answered conversations in this period">
          {data.meta.channel === 'ALL' ? 'Reply times appear once a conversation opened in this period has been answered.' : `Nothing opened on ${channelName(data.meta.channel)} in this period has been answered.`}
        </EmptyNote>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-1">How long customers waited for the first reply, across {fr.samples} {fr.samples === 1 ? 'conversation' : 'conversations'}.</p>
          <ul>
            {fr.buckets.map((b) => (
              <BarRow key={b.key} label={b.label} value={b.count} max={maxBucket} sub={formatShare(b.count, fr.samples)} />
            ))}
          </ul>
        </>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-5 pt-4 border-t border-gray-100">
        <div>
          <dt className="text-xs text-gray-500">Typical first reply</dt>
          <dd className="text-lg font-semibold tabular-nums">{fr.samples ? formatDuration(fr.medianSeconds) : 'n/a'}</dd>
          <dd className="text-xs text-gray-500">Verz AI or a person</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">First reply by a person</dt>
          <dd className="text-lg font-semibold tabular-nums">{fr.human.samples ? formatDuration(fr.human.medianSeconds) : 'n/a'}</dd>
          <dd className="text-xs text-gray-500">{fr.human.samples} {fr.human.samples === 1 ? 'conversation' : 'conversations'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 inline-flex items-center gap-1">Typical time to resolve <InfoTip definition={METRICS.resolution} /></dt>
          <dd className="text-lg font-semibold tabular-nums">{c.resolution.samples ? formatDuration(c.resolution.medianSeconds) : 'n/a'}</dd>
          <dd className="text-xs">{c.resolution.samples ? <DeltaBadge current={c.resolution.medianSeconds} previous={p.resolution.medianSeconds} direction="lower-is-better" /> : <span className="text-gray-500">Nothing resolved</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 inline-flex items-center gap-1">Response targets met <InfoTip definition={METRICS.sla} /></dt>
          <dd className="text-lg font-semibold tabular-nums">{slaMet != null ? formatShare(slaMet, c.sla.tracked) : 'n/a'}</dd>
          <dd className="text-xs text-gray-500">{slaMet != null ? `${c.sla.tracked} conversations had a deadline` : data.coverage.sla ? 'None in this period' : 'No deadlines are set'}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-500 mt-3">Reopened after being resolved: {c.reopened} <DeltaBadge current={c.reopened} previous={p.reopened} direction="lower-is-better" className="ml-1" /></p>
    </Panel>
  );
}

function Heatmap({ data }: { data: IntelligenceResponse }) {
  const cells = new Map(data.heatmap.map((h) => [`${h.dayOfWeek}-${h.hour}`, h.count]));
  const max = Math.max(0, ...data.heatmap.map((h) => h.count));
  const total = data.heatmap.reduce((s, h) => s + h.count, 0);
  const top = [...data.heatmap].sort((a, b) => b.count - a.count).slice(0, 3);
  const summary = top.length
    ? `Busiest times: ${top.map((t) => `${DAY_NAMES[t.dayOfWeek]} ${String(t.hour).padStart(2, '0')}:00 with ${t.count} messages`).join('; ')}.`
    : 'No customer messages in this period.';

  return (
    <Panel className="p-5">
      <PanelTitle>When customers message you</PanelTitle>
      {total === 0 ? (
        <EmptyNote title="No customer messages in this period" />
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">{summary} Times are in your workspace timezone ({data.meta.timezone}).</p>
          <div className="overflow-x-auto">
            <div role="img" aria-label={summary} className="min-w-[620px]">
              <div className="grid grid-cols-[3rem_repeat(24,minmax(0,1fr))] gap-[3px]">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="text-[10px] text-gray-500 text-center tabular-nums">{h % 3 === 0 ? h : ''}</span>
                ))}
                {DAY_SHORT.map((day, dow) => (
                  <div key={day} className="contents">
                    <span className="text-xs text-gray-600 flex items-center">{day}</span>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const count = cells.get(`${dow}-${hour}`) ?? 0;
                      const strength = max > 0 ? count / max : 0;
                      return (
                        <span
                          key={hour} title={`${DAY_NAMES[dow]} ${String(hour).padStart(2, '0')}:00, ${count} ${count === 1 ? 'message' : 'messages'}`}
                          className="aspect-square rounded-[3px] bg-teal-700"
                          style={{ opacity: count === 0 ? 0.06 : 0.18 + strength * 0.82 }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                Fewer
                {[0.06, 0.3, 0.55, 0.8, 1].map((o) => <span key={o} className="w-4 h-4 rounded-[3px] bg-teal-700" style={{ opacity: o }} />)}
                More messages
              </div>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

export default function ConversationsSection({ data }: { data: IntelligenceResponse }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2"><Waiting data={data} /></div>
        <div className="lg:col-span-3"><Speed data={data} /></div>
      </div>
      <Heatmap data={data} />
    </div>
  );
}
