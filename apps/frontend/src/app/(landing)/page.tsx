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
  title: 'VerzChat — WhatsApp Business Inbox for Teams',
  description: 'Handle every customer WhatsApp message from one shared inbox. Official Meta API. Teams live in under 20 minutes.',
  openGraph: {
    url: 'https://verzchat.com',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'VerzChat' }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@verzchat',
  },
  alternates: {
    canonical: '/',
  },
};

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'VerzChat',
  url: 'https://verzchat.com',
  logo: 'https://verzchat.com/logo.png',
  sameAs: [],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'sales',
    url: 'https://verzchat.com/book-demo',
  },
};

const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'VerzChat',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: 'Free trial available',
  },
  description:
    'Multi-channel business messaging platform. Handle every customer WhatsApp message from one shared inbox.',
};

const webSiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'VerzChat',
  url: 'https://verzchat.com',
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
