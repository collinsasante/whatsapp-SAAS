import { QrCode } from 'lucide-react';

/**
 * Small channel marker overlaid on a contact avatar. One component for the inbox list and the chat header
 * (they each carried a copy). Channels are identified by their stored Channel.type value, never by label.
 */
export type ChannelKind = 'WHATSAPP' | 'WHATSAPP_WEB' | 'FACEBOOK_MESSENGER' | 'INSTAGRAM';

/** Maps any stored or legacy spelling to a stable kind. A missing type is a legacy WhatsApp Cloud conversation. */
export function channelKind(channelType?: string | null): ChannelKind {
  const type = (channelType ?? 'WHATSAPP').toUpperCase();
  if (type === 'WHATSAPP_WEB') return 'WHATSAPP_WEB';
  if (type === 'MESSENGER' || type === 'FACEBOOK_MESSENGER') return 'FACEBOOK_MESSENGER';
  if (type === 'INSTAGRAM') return 'INSTAGRAM';
  return 'WHATSAPP';
}

export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  WHATSAPP: 'WhatsApp',
  WHATSAPP_WEB: 'WhatsApp Web (QR)',
  FACEBOOK_MESSENGER: 'Messenger',
  INSTAGRAM: 'Instagram',
};

const BASE = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-white';

export function ChannelBadge({ channelType }: { channelType?: string | null }) {
  const kind = channelKind(channelType);
  const label = CHANNEL_LABELS[kind];

  if (kind === 'WHATSAPP_WEB') {
    // A QR glyph on slate: clearly not the green WhatsApp Cloud badge, so linked-device chats stand out.
    return (
      <div role="img" aria-label={label} title={label} className={`${BASE} bg-slate-700`}>
        <QrCode className="w-2.5 h-2.5 text-white" strokeWidth={2.5} aria-hidden="true" />
      </div>
    );
  }
  if (kind === 'FACEBOOK_MESSENGER') {
    return (
      <div role="img" aria-label={label} title={label} className={`${BASE} bg-blue-600`}>
        <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.906 1.408 5.501 3.604 7.21V22l3.29-1.813C10.012 20.38 10.985 20.52 12 20.52c5.523 0 10-4.147 10-9.261C22 6.145 17.523 2 12 2zm1.05 12.474l-2.549-2.718-4.974 2.718 5.467-5.804 2.612 2.718 4.911-2.718-5.467 5.804z" />
        </svg>
      </div>
    );
  }
  if (kind === 'INSTAGRAM') {
    return (
      <div role="img" aria-label={label} title={label} className={`${BASE} overflow-hidden`} style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}>
        <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      </div>
    );
  }
  return (
    <div role="img" aria-label={label} title={label} className={`${BASE} bg-green-500`}>
      <svg className="w-2.5 h-2.5 text-white fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    </div>
  );
}
