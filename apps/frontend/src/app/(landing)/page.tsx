import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import TrustBar from '@/components/landing/TrustBar';
import Channels from '@/components/landing/Channels';
import Features from '@/components/landing/Features';
import Proof from '@/components/landing/Proof';
import Pricing from '@/components/landing/Pricing';
import BottomCTA from '@/components/landing/BottomCTA';
import Footer from '@/components/landing/Footer';

export const metadata = {
  title: 'VerzChat — WhatsApp Inbox for Your Team',
  description: 'Handle every customer WhatsApp message from one shared inbox. Official Meta API partner. Teams live in under 20 minutes.',
};

export default function LandingPage() {
  return (
    <>
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
