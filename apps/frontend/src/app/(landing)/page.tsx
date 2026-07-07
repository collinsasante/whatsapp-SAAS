import type { Metadata } from 'next';
import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import TrustBar from '@/components/landing/TrustBar';
import Channels from '@/components/landing/Channels';
import Features from '@/components/landing/Features';
import Proof from '@/components/landing/Proof';
import Pricing from '@/components/landing/Pricing';
import BottomCTA from '@/components/landing/BottomCTA';
import Footer from '@/components/landing/Footer';

export const metadata: Metadata = {
  // `absolute` explicitly bypasses the root layout's title.template ('%s | VerzChat')
  // -- this is the home page's own brand identity, not a "<page> | VerzChat" pattern.
  // Every other page's title should be the page-specific part ONLY (see lib/seo.ts);
  // this was previously a plain string here, which got the template applied on top
  // and rendered as "VerzChat — WhatsApp Business Inbox for Teams | VerzChat" live.
  title: { absolute: 'VerzChat — WhatsApp Business Inbox for Teams' },
  description: 'Handle every customer WhatsApp message from one shared inbox. Official Meta API. Teams live in under 20 minutes.',
  openGraph: {
    url: 'https://verzchat.com',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@verzchat',
  },
  alternates: {
    canonical: '/',
  },
};

// @id-tagged so other pages (faq/layout.tsx, contact-us) can reference these same
// entities via isPartOf/publisher/about instead of duplicating them -- previously
// these had no @id at all, so those cross-page references were dangling (pointed
// at fragment IDs nothing ever emitted).
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://verzchat.com/#organization',
  name: 'VerzChat',
  url: 'https://verzchat.com',
  logo: 'https://verzchat.com/logo.png',
  sameAs: ['https://twitter.com/verzchat'],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'sales',
    url: 'https://verzchat.com/book-demo',
  },
};

// Pricing here matches Pricing.tsx exactly (Free / Starter $16 / Pro $25, GHS via
// GHS_RATE=12.5 for Ghana-detected visitors) -- do not restate these numbers anywhere
// without checking that component first, they're the single source of truth.
const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://verzchat.com/#software',
  name: 'VerzChat',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Multi-channel business messaging platform. Handle every customer WhatsApp message from one shared inbox.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'GHS', description: 'Forever free, no card needed' },
    { '@type': 'Offer', name: 'Starter', price: '200', priceCurrency: 'GHS', description: 'Billed monthly' },
    { '@type': 'Offer', name: 'Pro', price: '313', priceCurrency: 'GHS', description: 'Billed monthly' },
  ],
};

const webSiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': 'https://verzchat.com/#website',
  name: 'VerzChat',
  url: 'https://verzchat.com',
  publisher: { '@id': 'https://verzchat.com/#organization' },
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
      />
      <Navbar />
      <Hero />
      <TrustBar />
      <Channels />
      <Features />
      <Proof />
      <Pricing />
      <BottomCTA />
      <Footer />
    </>
  );
}
