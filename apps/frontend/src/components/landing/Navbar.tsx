'use client';
import { useState } from 'react';
import Link from 'next/link';

const LINKS = [
  { label: 'Home', href: '#' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Contact', href: '#contact' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="kp_nav">
      <nav className="navbar navbar-expand-lg py-3">
        <div className="container">
          <Link href="/" className="navbar-brand me-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="VerzChat" className="brand_logo" />
          </Link>

          <button
            className="navbar-toggler border-0"
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <span className="navbar-toggler-icon" />
          </button>

          <div className={`collapse navbar-collapse ${open ? 'show' : ''}`}>
            <ul className="navbar-nav mx-auto mb-2 mb-lg-0 gap-1">
              {LINKS.map((l) => (
                <li key={l.label} className="nav-item">
                  <a href={l.href} className="nav-link" onClick={() => setOpen(false)}>{l.label}</a>
                </li>
              ))}
            </ul>
            <div className="d-flex align-items-center gap-3 mt-3 mt-lg-0">
              <Link href="/auth/login" className="login_link">Log in</Link>
              <Link href="/book-demo" className="btn_green" style={{ padding: '9px 28px', fontSize: '14px' }}>
                Start Free Trial
              </Link>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
