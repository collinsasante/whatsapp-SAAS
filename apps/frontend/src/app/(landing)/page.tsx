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

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    { '@type': 'Question', name: 'How much does VerzChat cost?', acceptedAnswer: { '@type': 'Answer', text: 'VerzChat is GHS 150 per month, all-inclusive. No per-message fees, no per-seat charges, no surprise bills. Cancel anytime.' } },
    { '@type': 'Question', name: 'Can I use my existing WhatsApp Business number?', acceptedAnswer: { '@type': 'Answer', text: 'Yes. You can port your existing WhatsApp Business number to VerzChat. The process takes about 10 minutes and we guide you through every step.' } },
    { '@type': 'Question', name: 'Is there a per-message fee?', acceptedAnswer: { '@type': 'Answer', text: 'No. VerzChat charges a flat monthly fee of GHS 150. Standard WhatsApp conversation fees from Meta may apply depending on your usage volume.' } },
    { '@type': 'Question', name: 'How many team members can I add?', acceptedAnswer: { '@type': 'Answer', text: 'Your GHS 150 plan supports unlimited agents. Invite your entire team — support staff, sales reps, managers — all from the same workspace.' } },
    { '@type': 'Question', name: 'Can I cancel at any time?', acceptedAnswer: { '@type': 'Answer', text: 'Yes — cancel anytime with no penalties. Your workspace stays active until the end of the current billing period, then closes.' } },
    { '@type': 'Question', name: 'Is my customer data secure?', acceptedAnswer: { '@type': 'Answer', text: 'All data is encrypted at rest and in transit using AES-256 and TLS 1.3. We are fully compliant with GDPR and NDPR. Your data is never sold or shared with third parties.' } },
    { '@type': 'Question', name: 'How quickly can my team get started?', acceptedAnswer: { '@type': 'Answer', text: 'Most teams are live in under 20 minutes. Connect your WhatsApp number, invite your agents, and you\'re handling conversations immediately.' } },
  ],
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
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
