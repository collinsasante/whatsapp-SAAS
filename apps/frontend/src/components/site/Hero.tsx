import Link from 'next/link';
import InboxMock from './InboxMock';
import styles from './Hero.module.css';

export default function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.copy}>
        <h1 id="hero-title" className={`h1 ${styles.title}`}>
          <span>A customer</span> <span>messages</span> <span>at 9&nbsp;pm.</span> <span>Who answers?</span>
        </h1>
        <p className={`lede ${styles.lede}`}>
          VerzChat puts your WhatsApp conversations in one shared inbox. Every chat has an owner you can see, either one
          of your agents or Verz AI, and you can take it over or hand it back with one click.
        </p>
        <div className={styles.actions}>
          <Link href="/auth/register" className="btn btn-solid">
            Start free
          </Link>
          <Link href="/book-demo" className="btn btn-line">
            Book a demo
          </Link>
        </div>
        <p className={styles.fine}>The free plan includes one agent and one WhatsApp channel. No card needed.</p>
      </div>

      <div className={`${styles.slab} on-dark`}>
        <InboxMock />
      </div>
    </section>
  );
}
