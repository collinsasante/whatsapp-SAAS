import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Footer from '@/components/landing/Footer';
import { buildMetadata } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'Book a Demo — See VerzChat in Action',
  description:
    'Schedule a personalized walkthrough of VerzChat. See how teams use one shared WhatsApp inbox to handle customer conversations at scale.',
  path: '/book-demo',
  ogImageAlt: 'Book a VerzChat Demo',
});

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  '@id': 'https://verzchat.com/book-demo/#breadcrumb',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://verzchat.com' },
    { '@type': 'ListItem', position: 2, name: 'Book a Demo', item: 'https://verzchat.com/book-demo' },
  ],
};

const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://verzchat.com/book-demo/#webpage',
  url: 'https://verzchat.com/book-demo',
  name: 'Book a Demo — See VerzChat in Action',
  description:
    'Schedule a personalized walkthrough of VerzChat. See how teams use one shared WhatsApp inbox to handle customer conversations at scale.',
  isPartOf: { '@id': 'https://verzchat.com/#website' },
  about: { '@id': 'https://verzchat.com/#software' },
  publisher: { '@id': 'https://verzchat.com/#organization' },
  inLanguage: 'en-US',
  breadcrumb: { '@id': 'https://verzchat.com/book-demo/#breadcrumb' },
};

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
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
      {children}
      <Footer />
    </div>
  );
}
