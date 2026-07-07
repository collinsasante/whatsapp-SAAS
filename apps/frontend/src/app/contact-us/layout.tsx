import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'Contact Us',
  description: 'Get in touch with the VerzChat team. Questions about WhatsApp Business API, pricing, or your account — we respond within 24 hours.',
  path: '/contact-us',
  keywords: ['VerzChat contact', 'WhatsApp business support', 'contact VerzChat', 'VerzChat help'],
  ogImageAlt: 'Contact VerzChat',
});

// ─── Structured data (server-rendered for best SEO) ───────────────────────────
// Same pattern as faq/layout.tsx -- references the sitewide Organization/WebSite
// entities declared with @id on the landing page ((landing)/page.tsx) rather than
// redeclaring them.

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  '@id': 'https://verzchat.com/contact-us/#breadcrumb',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://verzchat.com' },
    { '@type': 'ListItem', position: 2, name: 'Contact Us', item: 'https://verzchat.com/contact-us' },
  ],
};

const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://verzchat.com/contact-us/#webpage',
  url: 'https://verzchat.com/contact-us',
  name: 'Contact Us — VerzChat',
  description: 'Get in touch with the VerzChat team. Questions about WhatsApp Business API, pricing, or your account — we respond within 24 hours.',
  isPartOf: { '@id': 'https://verzchat.com/#website' },
  publisher: { '@id': 'https://verzchat.com/#organization' },
  inLanguage: 'en-US',
  breadcrumb: { '@id': 'https://verzchat.com/contact-us/#breadcrumb' },
};

export default function ContactUsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }}
      />
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}
