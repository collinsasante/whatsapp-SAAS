'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Menu, X, ChevronDown, Zap } from 'lucide-react';
import Link from 'next/link';

const navLinks = [
  { label: 'Features', href: '#features', children: ['Team Inbox', 'WhatsApp API', 'AI Chatbots', 'Campaigns', 'Analytics'] },
  { label: 'Solutions', href: '#solutions', children: ['Customer Support', 'Marketing', 'Sales', 'Enterprise'] },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Integrations', href: '#omnichannel' },
  { label: 'Resources', href: '#', children: ['Documentation', 'Blog', 'API Reference', 'Status'] },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-[#030712]/85 backdrop-blur-2xl border-b border-white/[0.06] shadow-[0_4px_24px_rgba(0,0,0,0.4)]'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className={`flex items-center justify-between transition-all duration-300 ${scrolled ? 'h-14' : 'h-16'}`}>
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.4)] group-hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] transition-shadow">
                <MessageSquare size={16} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="text-white font-bold text-lg tracking-tight">
                Verz<span className="text-emerald-400">Chat</span>
              </span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <div
                  key={link.label}
                  className="relative"
                  onMouseEnter={() => link.children && setActiveDropdown(link.label)}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <a
                    href={link.href}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-all duration-200"
                  >
                    {link.label}
                    {link.children && <ChevronDown size={13} className={`transition-transform duration-200 ${activeDropdown === link.label ? 'rotate-180' : ''}`} />}
                  </a>
                  <AnimatePresence>
                    {link.children && activeDropdown === link.label && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 mt-1 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl py-2 min-w-[180px] backdrop-blur-xl"
                      >
                        {link.children.map((child) => (
                          <a
                            key={child}
                            href="#"
                            className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                          >
                            {child}
                          </a>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </nav>

            {/* Right CTA */}
            <div className="hidden md:flex items-center gap-3">
              <Link href="/auth/login" className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5">
                Log in
              </Link>
              <Link
                href="/auth/register"
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all duration-200 hover:scale-[1.02]"
              >
                <Zap size={13} strokeWidth={2.5} />
                Start Free
              </Link>
            </div>

            {/* Mobile toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </motion.header>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-40 bg-[#030712] flex flex-col pt-20 px-6 pb-8"
          >
            <nav className="flex flex-col gap-1 flex-1">
              {navLinks.map((link, i) => (
                <motion.a
                  key={link.label}
                  href={link.href}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => setMobileOpen(false)}
                  className="text-lg font-medium text-slate-300 hover:text-white py-3 border-b border-white/[0.06] transition-colors"
                >
                  {link.label}
                </motion.a>
              ))}
            </nav>
            <div className="flex flex-col gap-3">
              <Link href="/auth/login" className="text-center py-3 text-slate-300 border border-white/10 rounded-xl hover:border-white/20 transition-colors">
                Log in
              </Link>
              <Link href="/auth/register" className="text-center py-3 font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl">
                Start Free Trial
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
