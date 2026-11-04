import { cn } from '@/lib/utils';

export interface MessageEnrichmentView {
  kind: 'TRANSCRIPT' | 'IMAGE_ANALYSIS' | string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | string;
  text: string | null;
  language?: string | null;
  errorCode?: string | null;
}

const WHY: Record<string, string> = {
  provider_unavailable: 'this workspace has no provider set up yet',
  insufficient_credits: 'there are not enough AI credits',
  spend_cap_reached: "today's AI spend cap was reached",
  too_large: 'the file is too large',
  unsupported_format: 'the file format is not supported',
  empty: 'the file is empty',
  bad_dimensions: 'the image size is not supported',
  media_unavailable: 'the file could not be read',
  provider_auth: 'the provider rejected our credentials',
};

/**
 * What a machine made of a customer's voice note or picture. It is always labelled as automatic and kept apart from the customer's own words (the caption
 * and message text), because it can be wrong, and it never stands in for what the person actually said or sent.
 */
export function MessageEnrichmentNote({ items, kind, outbound }: { items?: MessageEnrichmentView[] | null; kind: 'TRANSCRIPT' | 'IMAGE_ANALYSIS'; outbound: boolean }) {
  const e = items?.find((i) => i.kind === kind);
  if (!e || e.status === 'SKIPPED' && e.errorCode === 'disabled') return null;
  const label = kind === 'TRANSCRIPT' ? 'Transcript (automatic, may contain errors)' : 'Image description (automatic, may be wrong)';
  const tone = outbound ? 'border-white/25 text-white/90' : 'border-gray-200 text-gray-600';
  let body: string;
  if (e.status === 'COMPLETED') body = e.text ? e.text : kind === 'TRANSCRIPT' ? 'No speech detected.' : 'No description available.';
  else if (e.status === 'PENDING' || e.status === 'PROCESSING') body = kind === 'TRANSCRIPT' ? 'Transcribing…' : 'Describing…';
  else body = `${kind === 'TRANSCRIPT' ? 'Transcript' : 'Description'} unavailable${e.errorCode && WHY[e.errorCode] ? `: ${WHY[e.errorCode]}` : ''}.`;
  return (
    <div className={cn('mt-1.5 rounded-lg border-l-2 pl-2 text-xs', tone)} role="note" aria-label={label}>
      <p className="text-[10px] font-semibold opacity-80">{label}</p>
      <p className="whitespace-pre-wrap break-words">{body}</p>
    </div>
  );
}
