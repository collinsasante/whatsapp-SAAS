'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, MessageSquare, Zap } from 'lucide-react';

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'AI Engine', href: '#ai' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? 'bg-[#020917]/90 backdrop-blur-2xl border-b border-white/8 shadow-2xl shadow-black/30' : ''
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/30 group-hover:shadow-teal-500/50 transition-shadow">
            <MessageSquare size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">VerzChat</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {NAV.map(({ label, href }) => (
            <Link key={label} href={href} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200">
              {label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <Link href="/login" className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
            Sign in
          </Link>
          <Link href="/register" className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-teal-500 hover:bg-teal-400 text-white rounded-xl transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 hover:-translate-y-px">
            <Zap size={13} strokeWidth={2.5} />
            Start free trial
          </Link>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {open && (
        <div className="md:hidden bg-[#020917]/98 backdrop-blur-2xl border-b border-white/8 px-4 pb-5">
          <div className="flex flex-col gap-0.5 pt-2">
            {NAV.map(({ label, href }) => (
              <Link key={label} href={href} className="px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors" onClick={() => setOpen(false)}>
                {label}
              </Link>
            ))}
          </div>
          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-white/8">
            <Link href="/login" className="text-center py-2.5 text-sm text-slate-300 border border-white/15 rounded-xl hover:bg-white/5 transition-colors">Sign in</Link>
            <Link href="/register" className="text-center py-2.5 text-sm font-semibold bg-teal-500 hover:bg-teal-400 text-white rounded-xl transition-colors">Start free trial</Link>
          </div>
        </div>
      )}
    </header>
  );
}
