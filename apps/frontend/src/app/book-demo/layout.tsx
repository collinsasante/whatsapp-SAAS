import type { Metadata } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import '@/components/site/site.css';
import SiteFooter from '@/components/site/SiteFooter';

export const metadata: Metadata = {
  title: 'Book a Demo: See VerzChat in Action',
  description:
    'Schedule a personalized walkthrough of VerzChat. See how teams use one shared WhatsApp inbox to handle customer conversations at scale.',
  openGraph: {
    url: 'https://verzchat.com/book-demo',
  },
  alternates: {
    canonical: '/book-demo',
  },
};

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap', axes: ['opsz', 'wdth'] });

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} site`}>
      {children}
      <SiteFooter />
    </div>
  );
}
