import Link from 'next/link';
import { reveal } from './reveal';
import styles from './Overview.module.css';

export default function Overview() {
  return (
    <section className={styles.section} aria-labelledby="overview-title">
      <div className={`wrap ${styles.grid}`}>
        <h2 id="overview-title" className="h2" {...reveal()}>
          How a WhatsApp team inbox works in VerzChat
        </h2>
        <div className={styles.body} {...reveal(1)}>
          <p>
            Connect your WhatsApp number, through Meta&apos;s official Business Platform or by linking a phone with a QR
            code, and your whole team answers from one shared inbox in the browser. Every conversation keeps its full
            history, and every conversation has a visible owner.
          </p>
          <p>
            New requests wait in a queue, an agent claims a chat, and private notes and labels stay with it for whoever
            picks it up next. Verz AI can answer from your knowledge base or draft replies for an agent to send, and it
            hands the chat to a person when a customer asks for one.
          </p>
          <p className={styles.links}>
            <Link href="/#pricing">Compare the plans</Link>
            <Link href="/book-demo">Book a demo</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
