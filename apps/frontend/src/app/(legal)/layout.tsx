import { Bricolage_Grotesque } from 'next/font/google';
import '@/components/site/site.css';
import SiteFooter from '@/components/site/SiteFooter';
import SiteNav from '@/components/site/SiteNav';

// Same marketing shell as the home page: its header, footer and display face. The pages themselves are styled with Tailwind.
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap', axes: ['opsz', 'wdth'] });

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} site`}>
      <a href="#main" className="skip">Skip to content</a>
      <SiteNav />
      <main id="main" style={{ background: '#fff' }}>{children}</main>
      <SiteFooter />
    </div>
  );
}
