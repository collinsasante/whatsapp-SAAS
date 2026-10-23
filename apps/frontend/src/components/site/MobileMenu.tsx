'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from './SiteNav.module.css';

interface Props {
  links: ReadonlyArray<{ href: string; label: string }>;
}

export default function MobileMenu({ links }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={styles.mobile}>
      <button
        ref={button}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.toggleLabel}>{open ? 'Close' : 'Menu'}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
        </svg>
      </button>

      <div id="mobile-menu" className={styles.panel} hidden={!open}>
        <ul>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <Link href="/auth/login" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </li>
        </ul>
        <Link href="/auth/register" className="btn btn-solid" onClick={() => setOpen(false)}>
          Start free
        </Link>
      </div>
    </div>
  );
}
