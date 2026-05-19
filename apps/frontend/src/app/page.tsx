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
  title: 'VerzChat: WhatsApp Inbox for Your Team',
  description: 'Handle every customer message from one fast, reliable workspace. WhatsApp Business API, live chat, email, and calls, all in VerzChat.',
};

export default function LandingPage() {
  return (
    <div className="bg-white text-gray-900 overflow-x-hidden">
      <Navbar />
      <Hero />
      <TrustBar />
      <Channels />
      <Features />
      <Proof />
      <Pricing />
      <BottomCTA />
      <Footer />
    </div>
  );
}
