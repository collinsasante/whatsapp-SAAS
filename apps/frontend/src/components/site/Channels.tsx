import { CHANNELS } from './data';
import { ChannelGlyph } from './mock-parts';
import { reveal } from './reveal';
import styles from './Channels.module.css';

const GLYPH = {
  'whatsapp-api': 'whatsapp',
  'whatsapp-qr': 'whatsapp',
  messenger: 'messenger',
  instagram: 'instagram',
} as const;

export default function Channels() {
  return (
    <section id="channels" className={styles.section} aria-labelledby="channels-title">
      <div className="wrap">
        <h2 id="channels-title" className="h2" {...reveal()}>
          Where your customers can reach you
        </h2>
        <p className={`lede ${styles.lede}`}>
          We list a channel as working only when messages go in and out of the inbox. Anything still waiting on a
          third party is marked that way.
        </p>

        <ul className={styles.list}>
          {CHANNELS.map((c, i) => (
            <li key={c.id} className={styles.row} {...reveal(i)}>
              <ChannelGlyph channel={GLYPH[c.id]} size={30} />
              <div className={styles.body}>
                <h3 className="h3">{c.name}</h3>
                <p>{c.detail}</p>
              </div>
              <span className={`${styles.status} ${c.status === 'available' ? styles.ok : styles.soon}`}>
                {c.status === 'available' ? 'Available now' : 'Opening as Meta approves'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
