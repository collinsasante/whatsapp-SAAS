import type { Metadata } from 'next';
import Channels from '@/components/site/Channels';
import Faq from '@/components/site/Faq';
import FinalCta from '@/components/site/FinalCta';
import Hero from '@/components/site/Hero';
import Inside from '@/components/site/Inside';
import OwnerSection from '@/components/site/Owner';
import Pricing from '@/components/site/Pricing';
import ScrollReveal from '@/components/site/ScrollReveal';
import Problems from '@/components/site/Problems';
import SiteFooter from '@/components/site/SiteFooter';
import SiteNav from '@/components/site/SiteNav';
import Steps from '@/components/site/Steps';
import Trust from '@/components/site/Trust';
import { FAQ, PLANS, SUPPORT_EMAIL } from '@/components/site/data';

const TITLE = 'VerzChat: one shared inbox for WhatsApp, with Verz AI when you want it';
const DESCRIPTION =
  'Every customer conversation in one shared inbox, each with a visible owner: an agent or Verz AI. Take over or hand back with one click. Free plan available.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  // The image is named here because this page sets its own openGraph/twitter objects, which replaced the file-based one: the homepage was
  // the only public page whose link previews had no image.
  openGraph: {
    type: 'website', url: 'https://verzchat.com', siteName: 'VerzChat', title: TITLE, description: DESCRIPTION,
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/opengraph-image'] },
};

const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'VerzChat',
    url: 'https://verzchat.com',
    logo: 'https://verzchat.com/logo.png',
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: SUPPORT_EMAIL },
  },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'VerzChat', url: 'https://verzchat.com' },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'VerzChat',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: DESCRIPTION,
    offers: PLANS.map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: p.price.replace('$', ''),
      priceCurrency: 'USD',
    })),
  },
  // Generated from the same list the page renders, so the markup can never describe an answer the page does not show.
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
];

export default function LandingPage() {
  return (
    <>
      {structuredData.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          // "<" is escaped so no string in the data can close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }}
        />
      ))}
      <a href="#main" className="skip">
        Skip to content
      </a>
      <ScrollReveal />
      <SiteNav />
      <main id="main">
        <Hero />
        <Problems />
        <OwnerSection />
        <Inside />
        <Channels />
        <Steps />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
