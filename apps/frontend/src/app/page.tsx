'use client';
import dynamic from 'next/dynamic';

const SmoothScroll = dynamic(() => import('@/components/landing/SmoothScroll'), { ssr: false });
const Navbar = dynamic(() => import('@/components/landing/Navbar'));
const Hero = dynamic(() => import('@/components/landing/Hero'));
const Trust = dynamic(() => import('@/components/landing/Trust'));
const Features = dynamic(() => import('@/components/landing/Features'));
const Omnichannel = dynamic(() => import('@/components/landing/Omnichannel'));
const Inbox = dynamic(() => import('@/components/landing/Inbox'));
const ChatbotFlow = dynamic(() => import('@/components/landing/ChatbotFlow'));
const Campaigns = dynamic(() => import('@/components/landing/Campaigns'));
const CallsSection = dynamic(() => import('@/components/landing/CallsSection'));
const Analytics = dynamic(() => import('@/components/landing/Analytics'));
const Pricing = dynamic(() => import('@/components/landing/Pricing'));
const Testimonials = dynamic(() => import('@/components/landing/Testimonials'));
const FAQ = dynamic(() => import('@/components/landing/FAQ'));
const FinalCTA = dynamic(() => import('@/components/landing/FinalCTA'));
const Footer = dynamic(() => import('@/components/landing/Footer'));

export default function LandingPage() {
  return (
    <SmoothScroll>
      <div className="bg-[#030712] text-white overflow-x-hidden min-h-screen selection:bg-emerald-500/30 selection:text-emerald-200">
        <Navbar />
        <Hero />
        <Trust />
        <Features />
        <Omnichannel />
        <Inbox />
        <ChatbotFlow />
        <Campaigns />
        <CallsSection />
        <Analytics />
        <Pricing />
        <Testimonials />
        <FAQ />
        <FinalCTA />
        <Footer />
      </div>
    </SmoothScroll>
  );
}
