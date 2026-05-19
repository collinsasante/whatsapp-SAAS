import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

const LINKS = {
  Product: ['Features', 'AI Engine', 'Pricing', 'Changelog'],
  Company:  ['About', 'Blog', 'Careers', 'Press'],
  Support:  ['Documentation', 'API Reference', 'Status', 'Contact'],
  Legal:    ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR'],
};

export default function Footer() {
  return (
    <footer style={{ background: '#020917' }} className="border-t border-white/6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-10 mb-14">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
                <MessageSquare size={15} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="font-bold text-white">VerzChat</span>
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed">
              AI-powered customer communication for businesses that care about every conversation.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, items]) => (
            <div key={group}>
              <p className="text-white text-xs font-semibold uppercase tracking-widest mb-4">{group}</p>
              <ul className="space-y-2.5">
                {items.map(item => (
                  <li key={item}>
                    <Link href="#" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-white/6 gap-4">
          <p className="text-slate-600 text-sm">© {new Date().getFullYear()} VerzChat. All rights reserved.</p>
          <div className="flex items-center gap-5 text-slate-600 text-sm">
            <span>Made with ♥ for businesses that care</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
