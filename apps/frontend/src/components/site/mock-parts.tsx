import { INSTAGRAM_PATH, MESSENGER_PATH, WHATSAPP_PATH } from './channel-icons';
import styles from './mock-parts.module.css';

/** Message status ticks, as in the product: one tick sent, two delivered, two in green once read. */
export function Ticks({ state }: { state: 'sent' | 'delivered' | 'read' }) {
  const label = { sent: 'Sent', delivered: 'Delivered', read: 'Read' }[state];
  return (
    <span className={`${styles.ticks} ${state === 'read' ? styles.read : ''}`} role="img" aria-label={label}>
      <svg width="18" height="11" viewBox="0 0 18 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1.5 5.8l3 3L10 2" />
        {state !== 'sent' && <path d="M7 8.8l.6.6L13.5 2" />}
      </svg>
    </span>
  );
}

/** Who has the conversation. The three kinds are the page's one colour system. */
export function Owner({ kind, children }: { kind: 'person' | 'ai' | 'waiting'; children: React.ReactNode }) {
  return <span className={`${styles.owner} ${styles[kind]}`}>{children}</span>;
}

const CHANNEL_PATHS = { whatsapp: WHATSAPP_PATH, messenger: MESSENGER_PATH, instagram: INSTAGRAM_PATH } as const;
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram' } as const;

/** A channel's glyph on its brand-colour tile, the way the product's own channel markers draw it. */
export function ChannelGlyph({ channel, size = 18 }: { channel: keyof typeof CHANNEL_PATHS; size?: number }) {
  const inner = Math.round(size * 0.62);
  return (
    <span className={`${styles.tile} ${styles[`tile_${channel}`]}`} style={{ width: size, height: size }} role="img" aria-label={CHANNEL_LABEL[channel]}>
      <svg width={inner} height={inner} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={CHANNEL_PATHS[channel]} />
      </svg>
    </span>
  );
}
