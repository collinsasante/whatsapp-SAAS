import Link from 'next/link';
import { FAQ } from './data';
import { reveal } from './reveal';
import styles from './Faq.module.css';

export default function Faq() {
  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-title">
      <div className={`wrap ${styles.grid}`}>
        <h2 id="faq-title" className="h2" {...reveal()}>
          Questions we get asked
        </h2>
        <div className={styles.list} {...reveal(1)}>
          {FAQ.map((f) => (
            <details key={f.q} className={styles.item}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
              {f.links && (
                <p className={styles.more}>
                  Read more:{' '}
                  {f.links.map((l, i) => (
                    <span key={l.href}>
                      {i > 0 && ', '}
                      <Link href={l.href}>{l.label}</Link>
                    </span>
                  ))}
                </p>
              )}
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
