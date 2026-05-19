import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

const col1 = [
  { label: 'Features', href: '#features' },
  { label: 'Channels', href: '#channels' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Changelog', href: '#' },
];

const col2 = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Log in', href: '/auth/login' },
  { label: 'Register', href: '/auth/register' },
  { label: 'API Docs', href: '#' },
];

const col3 = [
  { label: 'Privacy Policy', href: '#' },
  { label: 'Terms of Service', href: '#' },
  { label: 'GDPR', href: '#' },
  { label: 'Status', href: '#' },
];

export default function Footer() {
  return (
    <footer className="bg-gray-900 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-[#25D366] flex items-center justify-center">
                <MessageSquare size={14} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="font-bold text-white text-[15px]">VerzChat</span>
            </Link>
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              The WhatsApp inbox for teams that take customer communication seriously.
            </p>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
              <span className="text-xs text-gray-500">All systems operational</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Product</p>
            <ul className="space-y-2">
              {col1.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">{l.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Account</p>
            <ul className="space-y-2">
              {col2.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Legal</p>
            <ul className="space-y-2">
              {col3.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">{l.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-600">© {new Date().getFullYear()} VerzChat. Built for teams that move fast.</p>
          <p className="text-xs text-gray-600">
            Questions? <a href="mailto:hello@verzchat.com" className="text-gray-400 hover:text-white transition-colors underline underline-offset-2">hello@verzchat.com</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
