import Image from 'next/image';
import Link from 'next/link';
import { SUPPORT_EMAIL } from './data';
import styles from './SiteFooter.module.css';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '#channels', label: 'Channels' },
      { href: '#pricing', label: 'Pricing' },
      { href: '#faq', label: 'FAQ' },
      { href: '/changelog', label: 'Changelog' },
      { href: '/api-docs', label: 'API documentation' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/auth/login', label: 'Sign in' },
      { href: '/auth/register', label: 'Start free' },
      { href: '/book-demo', label: 'Book a demo' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
      { href: '/gdpr', label: 'GDPR' },
      { href: '/data-deletion', label: 'Data deletion' },
      { href: '/status', label: 'System status' },
    ],
  },
] as const;

export default function SiteFooter() {
  return (
    <footer className={`${styles.footer} on-dark`}>
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.brand}>
          <Image src="/logo-white.svg" alt="VerzChat" width={150} height={34} />
          <p>One shared inbox for your customer conversations, with Verz AI when you want it.</p>
          <p>
            Questions? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>

        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className={styles.colTitle}>{c.title}</h2>
            <ul>
              {c.links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith('#') ? <a href={l.href}>{l.label}</a> : <Link href={l.href}>{l.label}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className={`wrap ${styles.base}`}>
        <p>© {new Date().getFullYear()} VerzChat</p>
      </div>
    </footer>
  );
}
