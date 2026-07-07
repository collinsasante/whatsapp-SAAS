import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata, breadcrumbSchema, webPageSchema } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'WhatsApp Broadcast Messaging',
  description:
    'Send WhatsApp broadcast campaigns to thousands of customers through the official Meta Business API. Track delivery, read, and click rates in real time.',
  path: '/whatsapp-broadcasts',
  keywords: [
    'WhatsApp broadcast messaging',
    'WhatsApp bulk messages',
    'WhatsApp business API broadcast',
    'send WhatsApp campaigns',
    'WhatsApp marketing messages',
  ],
  ogImageAlt: 'VerzChat WhatsApp broadcast messaging',
});

const pageBreadcrumb = breadcrumbSchema('/whatsapp-broadcasts', [
  { name: 'Home', path: '/' },
  { name: 'WhatsApp Broadcasts', path: '/whatsapp-broadcasts' },
]);

const pageSchema = webPageSchema({
  path: '/whatsapp-broadcasts',
  name: 'WhatsApp Broadcast Messaging — VerzChat',
  description:
    'Send WhatsApp broadcast campaigns to thousands of customers through the official Meta Business API. Track delivery, read, and click rates in real time.',
  hasBreadcrumb: true,
});

export default function WhatsappBroadcastsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageBreadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}
