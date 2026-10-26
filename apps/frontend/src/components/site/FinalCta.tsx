import Link from 'next/link';
import { reveal } from './reveal';
import styles from './FinalCta.module.css';

export default function FinalCta() {
  return (
    <section className={`${styles.section} on-dark`} aria-labelledby="cta-title">
      {/* The double tick every sent message earns. It is the logo's own gesture, drawn large, and carries no data. */}
      <svg className={styles.tick} viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 66l38 38L118 18" />
        <path d="M84 98l6 6L186 18" />
      </svg>
      <div className={`wrap ${styles.inner}`} {...reveal()}>
        <h2 id="cta-title" className="h2">
          Put your first channel in the inbox today
        </h2>
        <p className={styles.sub}>The free plan has one agent and one WhatsApp channel. You can upgrade when your team grows.</p>
        <div className={styles.actions}>
          <Link href="/auth/register" className="btn btn-light">
            Start free
          </Link>
          <Link href="/book-demo" className="btn btn-line-light">
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}
