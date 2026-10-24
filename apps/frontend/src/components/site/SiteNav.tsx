import Image from 'next/image';
import Link from 'next/link';
import MobileMenu from './MobileMenu';
import styles from './SiteNav.module.css';

export const NAV_LINKS = [
  { href: '/#owner', label: 'Who answers' },
  { href: '/#channels', label: 'Channels' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
] as const;

export default function SiteNav() {
  return (
    <header className={styles.header}>
      <nav className={`wrap ${styles.bar}`} aria-label="Main">
        <Link href="/" className={styles.brand} aria-label="VerzChat home">
          <Image src="/logo.png" alt="VerzChat" width={130} height={29} priority />
        </Link>

        <ul className={styles.links}>
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <Link href="/auth/login" className={styles.signin}>
            Sign in
          </Link>
          <Link href="/auth/register" className="btn btn-solid">
            Start free
          </Link>
        </div>

        <MobileMenu links={NAV_LINKS} />
      </nav>
    </header>
  );
}
