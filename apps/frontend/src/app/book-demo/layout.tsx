import type { Metadata } from 'next';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Footer from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Book a Demo — See VerzChat in Action',
  description:
    'Schedule a personalized walkthrough of VerzChat. See how teams use one shared WhatsApp inbox to handle customer conversations at scale.',
  openGraph: {
    url: 'https://verzchat.com/book-demo',
  },
  alternates: {
    canonical: '/book-demo',
  },
};

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      {children}
      <Footer />
    </div>
  );
}
