import Link from 'next/link';
import styles from './Trust.module.css';

const FACTS = [
  { text: 'WhatsApp runs on Meta\'s official Business Platform, connected from your own Meta Business account.' },
  { text: 'You can disconnect any channel at any time from the Channels page.' },
  { text: 'Conversations stay in your workspace, and you can ask us to delete your data.' },
  { text: 'Every release is written up in the changelog.' },
];

const LINKS = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/data-deletion', label: 'Data deletion' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/status', label: 'System status' },
  { href: '/api-docs', label: 'API documentation' },
];

export default function Trust() {
  return (
    <section className={styles.section} aria-labelledby="trust-title">
      <div className={`wrap ${styles.grid}`}>
        <div>
          <h2 id="trust-title" className="h2">
            What we can show you today
          </h2>
          <p className={`lede ${styles.lede}`}>
            There are no customer logos or quotes on this page. We would rather you open the free plan and judge the inbox
            yourself, and read how we handle your data first.
          </p>
        </div>

        <div className={styles.right}>
          <ul className={styles.facts}>
            {FACTS.map((f) => (
              <li key={f.text}>{f.text}</li>
            ))}
          </ul>
          <ul className={styles.links} aria-label="Policies and documentation">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
