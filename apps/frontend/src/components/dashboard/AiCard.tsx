'use client';
import Link from 'next/link';
import { formatNumber } from '@/lib/analytics/format';
import type { DashboardAi } from '@/lib/dashboard/types';
import { EmptyNote } from '@/components/analytics/ui';

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-xl font-semibold text-gray-900 tabular-nums">{value}</dd>
      <dd className="text-xs text-gray-500">{note}</dd>
    </div>
  );
}

export default function AiCard({ data }: { data: DashboardAi }) {
  const { current: c, credits } = data;
  if (!data.coverage.ai) {
    return (
      <EmptyNote
        title={data.enabled ? 'Verz AI has not handled a conversation yet' : 'Verz AI is turned off'}
        href="/ai" hrefLabel={data.enabled ? 'Review AI settings' : 'Set up Verz AI'}
      >
        {data.enabled
          ? 'Once customers write in, its replies, hand-offs and credit use appear here.'
          : 'Turn it on to let it draft or send replies. Its activity will appear here.'}
      </EmptyNote>
    );
  }
  const handoffShare = c.engagedConversations > 0 ? Math.round((c.handedToPerson / c.engagedConversations) * 100) : null;
  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        {data.enabled
          ? data.mode === 'AUTO_REPLY' ? 'Verz AI replies on its own and passes conversations to your team when it should.' : 'Verz AI drafts replies and your team decides what to send.'
          : 'Verz AI is turned off. These numbers are from while it was on.'}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat label="Conversations with Verz AI" value={formatNumber(c.engagedConversations)} note="It wrote a reply or a suggestion" />
        <Stat label="Replies sent by itself" value={formatNumber(c.autoReplies)} note={c.suggestions > 0 ? `${formatNumber(c.suggestionsSent)} of ${formatNumber(c.suggestions)} suggestions used` : 'No suggestions made'} />
        <Stat
          label="Passed to a person" value={formatNumber(c.handedToPerson)}
          note={handoffShare == null ? 'No AI conversations yet' : `${handoffShare}% of its conversations`}
        />
        <Stat label="Resolved without a person" value={formatNumber(c.resolvedWithoutPerson)} note="Replied by Verz AI, no message from your team" />
      </dl>
      <div className="mt-4 pt-3 border-t border-gray-100 text-sm text-gray-700">
        <p>
          <span className="font-semibold text-gray-900 tabular-nums">{formatNumber(credits.balance)}</span> AI credits left
          {credits.usedCurrent != null && <>, <span className="tabular-nums">{formatNumber(credits.usedCurrent)}</span> used in this period</>}.
        </p>
        <Link href="/ai" className="inline-block mt-1 font-medium text-teal-700 hover:underline">Open Verz AI</Link>
      </div>
    </div>
  );
}
