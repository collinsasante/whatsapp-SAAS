import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata } from '@/lib/seo';
import {
  GETTING_STARTED_FAQS,
  INBOX_FEATURES_FAQS,
  PRICING_SECURITY_FAQS,
} from './faq-data';

export const metadata = buildMetadata({
  title: 'FAQ',
  description:
    'Answers to common questions about VerzChat — shared inbox setup, supported channels, pricing, team management, automation, and data security.',
  path: '/faq',
  keywords: [
    'VerzChat FAQ',
    'WhatsApp Business API questions',
    'shared inbox help',
    'VerzChat pricing',
    'WhatsApp team inbox setup',
    'VerzChat support',
    'WhatsApp shared inbox FAQ',
    'multi-channel inbox questions',
  ],
  ogImageAlt: 'VerzChat FAQ',
});

// ─── Structured data (server-rendered for best SEO) ───────────────────────────

const allFaqs = [
  ...GETTING_STARTED_FAQS,
  ...INBOX_FEATURES_FAQS,
  ...PRICING_SECURITY_FAQS,
];

// 1. FAQPage — surfaces expandable Q&A directly in Google Search results
const faqPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': 'https://verzchat.com/faq/#faqpage',
  name: 'VerzChat — Frequently Asked Questions',
  url: 'https://verzchat.com/faq',
  description:
    'Answers to common questions about the VerzChat shared business inbox — channels, team setup, pricing, automation, and security.',
  isPartOf: { '@id': 'https://verzchat.com/#website' },
  publisher: { '@id': 'https://verzchat.com/#organization' },
  inLanguage: 'en-US',
  mainEntity: allFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.a,
    },
  })),
};

// 2. BreadcrumbList — shows navigation path in Google SERP snippets
const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  '@id': 'https://verzchat.com/faq/#breadcrumb',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://verzchat.com',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'FAQ',
      item: 'https://verzchat.com/faq',
    },
  ],
};

// 3. WebPage — describes this page to search engines with full metadata
const webPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://verzchat.com/faq/#webpage',
  url: 'https://verzchat.com/faq',
  name: 'FAQ — VerzChat',
  description:
    'Answers to common questions about VerzChat — shared inbox setup, supported channels (WhatsApp, Instagram, Facebook, Telegram, TikTok), pricing, team management, automation, and data security.',
  isPartOf: { '@id': 'https://verzchat.com/#website' },
  about: { '@id': 'https://verzchat.com/#software' },
  publisher: { '@id': 'https://verzchat.com/#organization' },
  inLanguage: 'en-US',
  datePublished: '2024-01-01',
  breadcrumb: { '@id': 'https://verzchat.com/faq/#breadcrumb' },
};

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema) }}
      />
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
