import { FAQ } from './data';
import styles from './Faq.module.css';

export default function Faq() {
  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-title">
      <div className={`wrap ${styles.grid}`}>
        <h2 id="faq-title" className="h2">
          Questions we get asked
        </h2>
        <div className={styles.list}>
          {FAQ.map((f) => (
            <details key={f.q} className={styles.item}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
