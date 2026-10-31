import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import '@/components/site/site.css';
import SiteFooter from '@/components/site/SiteFooter';
import { APP_VIEWPORT } from '@/lib/seo/site';

export const metadata: Metadata = {
  title: 'Book a demo of the WhatsApp shared inbox',
  description:
    'Schedule a personalized walkthrough of VerzChat. See how teams use one shared WhatsApp inbox to handle customer conversations at scale.',
  openGraph: {
    url: 'https://verzchat.com/book-demo',
  },
  alternates: {
    canonical: '/book-demo',
  },
};

// Indexable, but its form fields are 14px: without this lock iOS zooms into a field when it is focused. Lift it when the fields are 16px.
export const viewport: Viewport = APP_VIEWPORT;

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap', axes: ['opsz', 'wdth'] });

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} site`}>
      {children}
      <SiteFooter />
    </div>
  );
}
