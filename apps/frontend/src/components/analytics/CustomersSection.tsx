'use client';
import Link from 'next/link';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { channelName, formatNumber, formatShare, sourceName } from '@/lib/analytics/format';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { BarRow, DeltaBadge, EmptyNote, Panel, PanelTitle } from './ui';

const CHANNEL_COLORS: Record<string, string> = { WHATSAPP: '#0d9488', FACEBOOK_MESSENGER: '#2563eb', INSTAGRAM: '#be185d' };

function ChannelShare({ data }: { data: IntelligenceResponse }) {
  const rows = data.channels.filter((c) => c.conversations > 0);
  const total = rows.reduce((s, c) => s + c.conversations, 0);
  if (total === 0) return <EmptyNote title="No conversations in this period" />;
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      {rows.length > 1 && (
        <div className="w-36 h-36 flex-shrink-0" role="img" aria-label={`Conversation share by channel: ${rows.map((r) => `${channelName(r.channel)} ${formatShare(r.conversations, total)}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
            <PieChart>
              <Pie data={rows} dataKey="conversations" nameKey="channel" innerRadius={42} outerRadius={64} paddingAngle={2} isAnimationActive={false} stroke="none">
                {rows.map((r) => <Cell key={r.channel} fill={CHANNEL_COLORS[r.channel] ?? '#6b7280'} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Conversations, qualified leads and paid orders by channel</caption>
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th scope="col" className="py-2 pr-3 font-medium">Channel</th>
              <th scope="col" className="py-2 pr-3 font-medium text-right">Conversations</th>
              <th scope="col" className="py-2 pr-3 font-medium text-right">Qualified leads</th>
              <th scope="col" className="py-2 font-medium text-right">Paid orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.channels.map((c) => (
              <tr key={c.channel}>
                <th scope="row" className="py-2 pr-3 text-left font-medium text-gray-900">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[c.channel] }} />
                    {channelName(c.channel)}
                  </span>
                </th>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatNumber(c.conversations)}
                  <span className="block text-xs"><DeltaBadge current={c.conversations} previous={c.previousConversations} direction="neutral" /></span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{data.coverage.leads ? formatNumber(c.qualifiedLeads) : 'n/a'}</td>
                <td className="py-2 text-right tabular-nums">{data.coverage.orders ? formatNumber(c.paidOrders) : 'n/a'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">This table always compares every channel, whatever channel filter is selected.</p>
      </div>
    </div>
  );
}

function Funnel({ data }: { data: IntelligenceResponse }) {
  const { leads } = data.current;
  if (!data.coverage.leads) {
    return <EmptyNote title="No leads are recorded yet">Leads appear once Verz AI has scored a conversation. Turn on Verz AI to start building a pipeline here.</EmptyNote>;
  }
  if (leads.created === 0) return <EmptyNote title="No leads were created in this period" />;
  const stages = [
    { label: 'Leads created', value: leads.created },
    { label: 'Qualified or better', value: leads.qualified },
    { label: 'Converted', value: leads.converted },
  ];
  return (
    <div>
      <ol className="space-y-2">
        {stages.map((s, i) => {
          const share = (s.value / leads.created) * 100;
          const fromPrevious = i > 0 && stages[i - 1].value > 0 ? formatShare(s.value, stages[i - 1].value) : null;
          return (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-gray-700">{s.label}</span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {formatNumber(s.value)}
                  {fromPrevious && <span className="ml-2 text-xs font-normal text-gray-500">{fromPrevious} of the stage above</span>}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-100 mt-1 overflow-hidden" aria-hidden="true">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(s.value > 0 ? 2 : 0, share)}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-gray-500 mt-3">
        Follows the leads created in this period to where they are now. Stages come from automatic lead scoring, so they are an assessment rather than a confirmed sale.
        {data.leadStatuses.length > 0 && <> Current statuses: {data.leadStatuses.map((s) => `${s.status.toLowerCase()} ${s.count}`).join(', ')}.</>}
      </p>
    </div>
  );
}

export default function CustomersSection({ data }: { data: IntelligenceResponse }) {
  const { current, previous } = data;
  const c = current.conversations;
  const maxSource = Math.max(0, ...data.sources.map((s) => s.conversations));
  const maxProduct = Math.max(0, ...data.productInterest.map((p) => p.leads));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Panel className="p-5 lg:col-span-3">
        <PanelTitle>Where conversations come from</PanelTitle>
        <ChannelShare data={data} />

        <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">New and returning customers</h4>
            {c.total === 0 ? <p className="text-sm text-gray-500">No conversations in this period.</p> : (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
                  <div className="bg-teal-600" style={{ width: `${(c.newContact / c.total) * 100}%` }} />
                  <div className="bg-slate-400" style={{ width: `${(c.returningContact / c.total) * 100}%` }} />
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-teal-600" />First conversation</dt><dd className="tabular-nums">{c.newContact} ({formatShare(c.newContact, c.total)})</dd></div>
                  <div className="flex justify-between"><dt className="inline-flex items-center gap-2"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-slate-400" />Came back</dt><dd className="tabular-nums">{c.returningContact} ({formatShare(c.returningContact, c.total)})</dd></div>
                </dl>
                <p className="text-xs text-gray-500 mt-2">
                  Customers who messaged: {formatNumber(current.activeContacts)} <DeltaBadge current={current.activeContacts} previous={previous.activeContacts} direction="higher-is-better" className="ml-1" />
                </p>
              </>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">How they found you</h4>
            {data.sources.length === 0 ? <p className="text-sm text-gray-500">No conversations in this period.</p> : (
              <ul>
                {data.sources.map((s) => (
                  <BarRow key={s.source} label={sourceName(s.source)} value={s.conversations} max={maxSource} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="p-5 lg:col-span-2">
        <PanelTitle aside={<Link href="/contacts" className="text-xs font-medium text-teal-700 hover:underline">Open contacts</Link>}>
          Lead pipeline
        </PanelTitle>
        <Funnel data={data} />
        {data.coverage.leads && data.productInterest.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h4 className="text-sm font-semibold text-gray-900">What leads asked about</h4>
            <p className="text-xs text-gray-500 mb-1">Picked out of the conversation by Verz AI, so treat it as a guide.</p>
            <ul>
              {data.productInterest.map((p) => <BarRow key={p.product} label={p.product} value={p.leads} max={maxProduct} />)}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
