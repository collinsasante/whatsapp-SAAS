import { ChannelGlyph, Owner, Ticks } from './mock-parts';
import styles from './InboxMock.module.css';

/**
 * An illustration of the VerzChat inbox built from the product's real concepts: the Requests queue, the owner of
 * each conversation, Intervene and Return to AI, the Message and Note tabs, and message ticks. The names and
 * messages are sample data and the caption says so. The conversation plays once on load (CSS only, and not at
 * all for people who prefer reduced motion, who see the finished state).
 */
export default function InboxMock() {
  return (
    <figure className={styles.figure}>
      <div className={styles.mock} aria-hidden="true">
        <aside className={styles.list}>
          <div className={styles.listHead}>
            <strong>Inbox</strong>
            <div className={styles.tabs}>
              <span className={styles.tabOn}>All</span>
              <span>Requests</span>
              <span>Resolved</span>
            </div>
          </div>

          <div className={`${styles.row} ${styles.rowOn}`}>
            <span className={`${styles.avatar} ${styles.a1}`}>EM</span>
            <div className={styles.rowBody}>
              <div className={styles.rowTop}>
                <b>Efua M.</b>
                <time>21:04</time>
              </div>
              <p>Hi Efua, Kwame here. Where should we deliver?</p>
              <div className={styles.rowMeta}>
                <ChannelGlyph channel="whatsapp" size={14} />
                <Owner kind="person">Kwame</Owner>
              </div>
            </div>
          </div>

          <div className={styles.row}>
            <span className={`${styles.avatar} ${styles.a2}`}>KA</span>
            <div className={styles.rowBody}>
              <div className={styles.rowTop}>
                <b>Kojo A.</b>
                <time>20:48</time>
              </div>
              <p>Thanks, I got it!</p>
              <div className={styles.rowMeta}>
                <ChannelGlyph channel="whatsapp" size={14} />
                <Owner kind="ai">Verz AI</Owner>
              </div>
            </div>
          </div>

          <div className={styles.row}>
            <span className={`${styles.avatar} ${styles.a3}`}>AK</span>
            <div className={styles.rowBody}>
              <div className={styles.rowTop}>
                <b>Adwoa K.</b>
                <time>20:31</time>
              </div>
              <p>Can someone call me about my order?</p>
              <div className={styles.rowMeta}>
                <ChannelGlyph channel="whatsapp" size={14} />
                <Owner kind="waiting">Needs a person</Owner>
              </div>
            </div>
          </div>
        </aside>

        <section className={styles.thread}>
          <header className={styles.threadHead}>
            <span className={`${styles.avatar} ${styles.a1}`}>EM</span>
            <div className={styles.who}>
              <b>Efua M.</b>
              <div className={styles.status}>
                <span className={styles.statusAi}>
                  <Owner kind="ai">Verz AI is answering</Owner>
                </span>
                <span className={styles.statusPerson}>
                  <Owner kind="person">Kwame has this chat</Owner>
                </span>
              </div>
            </div>
            <span className={styles.ghost}>Return to AI</span>
            <span className={styles.resolve}>Resolve</span>
          </header>

          <div className={styles.messages}>
            <div className={`${styles.step} ${styles.in}`} style={{ '--d': '0.4s' } as React.CSSProperties}>
              <p>Hi! Is the blue one still in stock? Size M.</p>
              <time>21:02</time>
            </div>

            <div className={`${styles.step} ${styles.outAi}`} style={{ '--d': '1.6s' } as React.CSSProperties}>
              <span className={styles.aiLabel}>Verz AI</span>
              <p>Yes, the blue one is in stock in size M. Shall I reserve it for you?</p>
              <time>21:02</time>
            </div>

            <div className={`${styles.step} ${styles.in}`} style={{ '--d': '3s' } as React.CSSProperties}>
              <p>Yes please. Can I talk to someone about delivery?</p>
              <time>21:03</time>
            </div>

            <div className={`${styles.step} ${styles.banner}`} style={{ '--d': '3.9s' } as React.CSSProperties}>
              Efua asked for a person. Moved to Requests.
            </div>

            <div className={`${styles.step} ${styles.pill}`} style={{ '--d': '5s' } as React.CSSProperties}>
              <Owner kind="person">Kwame took over</Owner>
            </div>

            <div className={`${styles.step} ${styles.outPerson}`} style={{ '--d': '5.7s' } as React.CSSProperties}>
              <p>Hi Efua, Kwame here. Where should we deliver?</p>
              <div className={styles.foot}>
                <time>21:04</time>
                <span className={styles.tickStack}>
                  <span className={styles.tSent}>
                    <Ticks state="sent" />
                  </span>
                  <span className={styles.tDelivered}>
                    <Ticks state="delivered" />
                  </span>
                  <span className={styles.tRead}>
                    <Ticks state="read" />
                  </span>
                </span>
              </div>
            </div>
          </div>

          <footer className={styles.composer}>
            <div className={styles.composerTabs}>
              <span className={styles.tabOn}>Message</span>
              <span>Note</span>
            </div>
            <div className={styles.input}>Send your message…</div>
          </footer>
        </section>
      </div>
      <figcaption className={styles.caption}>Illustration of the inbox. Names and messages are sample data.</figcaption>
    </figure>
  );
}
