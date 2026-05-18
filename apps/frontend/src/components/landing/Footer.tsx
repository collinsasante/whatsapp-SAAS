'use client';
import { motion } from 'framer-motion';
import { MessageSquare, Twitter, Linkedin, Github, Youtube, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const footerLinks = {
  Product: [
    { label: 'Team Inbox', href: '#' },
    { label: 'WhatsApp API', href: '#' },
    { label: 'AI Chatbots', href: '#' },
    { label: 'Campaigns', href: '#' },
    { label: 'Automation', href: '#' },
    { label: 'Analytics', href: '#' },
    { label: 'Calls', href: '#' },
    { label: 'CRM', href: '#' },
  ],
  Solutions: [
    { label: 'Customer Support', href: '#' },
    { label: 'Marketing', href: '#' },
    { label: 'Sales', href: '#' },
    { label: 'E-commerce', href: '#' },
    { label: 'Healthcare', href: '#' },
    { label: 'Finance', href: '#' },
    { label: 'Enterprise', href: '#' },
  ],
  Developers: [
    { label: 'API Reference', href: '#' },
    { label: 'Webhooks', href: '#' },
    { label: 'SDKs', href: '#' },
    { label: 'Integrations', href: '#' },
    { label: 'Status Page', href: '#' },
    { label: 'Changelog', href: '#' },
  ],
  Resources: [
    { label: 'Documentation', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Case Studies', href: '#' },
    { label: 'Help Center', href: '#' },
    { label: 'Community', href: '#' },
    { label: 'Webinars', href: '#' },
  ],
  Company: [
    { label: 'About Us', href: '#' },
    { label: 'Careers', href: '#' },
    { label: 'Press Kit', href: '#' },
    { label: 'Contact', href: '#' },
    { label: 'Partners', href: '#' },
  ],
};

const socialLinks = [
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Youtube, href: '#', label: 'YouTube' },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30 pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Newsletter */}
        <div className="py-10 border-b border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-white font-bold text-lg mb-1">Stay in the loop</h3>
            <p className="text-slate-500 text-sm">Get the latest news, product updates, and tips — once a week.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="email"
              placeholder="you@company.com"
              className="flex-1 sm:w-64 bg-white/[0.05] border border-white/[0.1] text-white text-sm rounded-xl px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
            />
            <button className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-400 transition-colors flex-shrink-0">
              Subscribe <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Links grid */}
        <div className="py-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <MessageSquare size={16} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="text-white font-bold text-lg">Verz<span className="text-emerald-400">Chat</span></span>
            </Link>
            <p className="text-slate-500 text-xs leading-relaxed mb-5">
              The AI-powered customer communication platform built for modern businesses.
            </p>
            <div className="flex items-center gap-2">
              {socialLinks.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-500 hover:text-white hover:border-white/[0.15] transition-all"
                >
                  <s.icon size={14} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">{category}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="py-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} VerzChat. All rights reserved.</p>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR'].map((item) => (
              <a key={item} href="#" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">{item}</a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-500">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
