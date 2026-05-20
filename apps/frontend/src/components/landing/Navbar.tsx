'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';

const links = [
  { label: 'Features', href: '#features' },
  { label: 'Channels', href: '#channels' },
  { label: 'Pricing', href: '#pricing' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
          scrolled ? 'bg-white/95 backdrop-blur-sm shadow-sm' : 'bg-white'
        } border-b border-gray-100`}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between" style={{ height: 60 }}>
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="VerzChat" className="h-8" />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="px-3.5 py-2 text-sm text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-3 py-2">
              Log in
            </Link>
            <Link
              href="/auth/register"
              className="text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
            >
              Get started free
            </Link>
            <Link
              href="/auth/register"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
            >
              Book a Demo
            </Link>
          </div>

          <button
            className="md:hidden p-2 text-gray-500 hover:text-gray-900 transition-colors"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[60px] left-0 right-0 z-40 bg-white border-b border-gray-100 shadow-lg md:hidden"
          >
            <div className="px-5 py-4 flex flex-col gap-1">
              {links.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  {l.label}
                </a>
              ))}
              <div className="border-t border-gray-100 mt-2 pt-3 flex flex-col gap-2">
                <Link href="/auth/login" className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-center">
                  Log in
                </Link>
                <Link href="/auth/register" className="text-sm font-semibold text-white bg-[#25D366] hover:bg-[#1aad57] px-4 py-2.5 rounded-lg transition-colors text-center">
                  Get started free
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
